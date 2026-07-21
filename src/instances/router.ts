// Instance routing layer for multi-instance VectorStore operations.
//
// InstanceRouter wraps one VectorStore per InstanceConfig and exposes the same
// public method signatures. File-level operations (insertChunks, deleteChunks,
// getChunksByFilePath, getChunksByRange) are routed to the most-specific
// instance based on filePath prefix matching. Search, aggregation, and config
// operations broadcast or merge results across all stores.

import { isUnderOrEqual } from '../utils/scope-match.js'
import {
  type CodeChunkMetaRow,
  type SearchResult,
  type TextReferenceRow,
  type VectorChunk,
  VectorStore,
} from '../vectordb/index.js'
import type { ChunkRow, GroupingMode, SearchOptions, VectorStoreConfig } from '../vectordb/types.js'
import { DEFAULT_HYBRID_WEIGHT } from '../vectordb/types.js'
import type { InstanceConfig } from './types.js'

// ============================================
// Constants
// ============================================

/** Fixed table name for every instance store. */
const TABLE_NAME = 'chunks'

// ============================================
// Types
// ============================================

/** Search options accepted by InstanceRouter.search, extended with instance selector. */
export interface RouterSearchOptions extends SearchOptions {
  /** Instance name to search ("*" or undefined = all instances). */
  instance?: string
}

/**
 * Per-instance file info aggregated from {@link InstanceRouter.listFiles}.
 * Mirrors the shape returned by {@link VectorStore.listFiles} so existing
 * consumers can iterate the result unchanged.
 */
export type FileInfo = {
  filePath: string
  chunkCount: number
  timestamp: string
}

/**
 * Aggregated status returned by {@link InstanceRouter.getStatus}.
 * Extends the single-store shape with a per-instance breakdown.
 */
export interface AggregatedStatus {
  documentCount: number
  chunkCount: number
  memoryUsage: number
  uptime: number
  ftsIndexEnabled: boolean
  searchMode: 'hybrid' | 'vector-only'
  instances: Array<{
    name: string
    documentCount: number
    chunkCount: number
  }>
}

/** Runtime search config subset accepted by {@link InstanceRouter.updateConfig}. */
export type RuntimeConfig = Partial<
  Pick<VectorStoreConfig, 'hybridWeight' | 'maxDistance' | 'maxFiles' | 'grouping'>
>

// ============================================
// InstanceRouter
// ============================================

export class InstanceRouter {
  private stores: Map<
    string,
    {
      config: InstanceConfig
      store: VectorStore
    }
  > = new Map()

  constructor(instances: InstanceConfig[]) {
    for (const cfg of instances) {
      this.stores.set(cfg.name, {
        config: cfg,
        store: new VectorStore({ dbPath: cfg.dbPath, tableName: TABLE_NAME }),
      })
    }
  }

  // ---- Lifecycle ----

  /** Initialize all instance stores. First failure stops the whole init. */
  async initialize(): Promise<void> {
    const names = [...this.stores.keys()]
    for (const name of names) {
      const entry = this.stores.get(name)
      if (!entry) continue
      await entry.store.initialize()
    }
  }

  /** Close all instance stores. Errors are swallowed so one stuck store does not block others. */
  async close(): Promise<void> {
    const names = [...this.stores.keys()]
    for (const name of names) {
      const entry = this.stores.get(name)
      if (!entry) continue
      try {
        await entry.store.close()
      } catch {
        // Swallow individual close errors — best-effort shutdown.
      }
    }
  }

  // ---- Instance lookup ----

  /** Return the list of configured instance names. */
  get instanceNames(): string[] {
    return [...this.stores.keys()]
  }

  /** Reflect hybridWeight from any store (all stores share the same config via broadcast updateConfig). */
  get hybridWeight(): number {
    for (const [, entry] of this.stores) {
      return entry.store.hybridWeight
    }
    return DEFAULT_HYBRID_WEIGHT
  }

  /** Reflect maxDistance from any store. */
  get maxDistance(): number | undefined {
    for (const [, entry] of this.stores) {
      return entry.store.maxDistance
    }
    return undefined
  }

  /** Reflect grouping from any store. */
  get grouping(): GroupingMode | undefined {
    for (const [, entry] of this.stores) {
      return entry.store.grouping
    }
    return undefined
  }

  /** Reflect maxFiles from any store. */
  get maxFiles(): number | undefined {
    for (const [, entry] of this.stores) {
      return entry.store.maxFiles
    }
    return undefined
  }

  // ---- Search ----

  /**
   * Execute vector search, optionally scoped to a single instance.
   *
   * - `instance = "name"` → search only that instance.
   * - `instance = "*"` or absent → search all instances, each with its own
   *   top-`limit`, merged preserving per-instance intra-ranking. Scores from
   *   different LanceDB instances are not comparable, so cross-instance
   *   re-ranking is NOT performed.
   *
   * Side-effect: warnings from individual instance failures are emitted to
   * stderr so callers can surface them via diagnostic channels.
   */
  async search(queryVector: number[], options: RouterSearchOptions = {}): Promise<SearchResult[]> {
    const { instance, ...searchOpts } = options

    if (instance !== undefined && instance !== '*' && instance.length > 0) {
      const store = this.getStore(instance)
      if (!store) {
        throw new RouterError(`Unknown instance: ${instance}`)
      }
      return store.search(queryVector, searchOpts)
    }

    // Cross-instance: each store independently returns top-limit results.
    const limit = searchOpts.limit ?? 10
    const results: (SearchResult & { _instance: string })[] = []

    for (const [name, entry] of this.stores) {
      try {
        const perInstance = await entry.store.search(queryVector, {
          ...searchOpts,
          limit,
        })
        for (const r of perInstance) {
          results.push({ ...r, _instance: name })
        }
      } catch (error) {
        console.error(
          `InstanceRouter: search on instance "${name}" failed:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    // Strip the internal _instance tag before returning.
    return results.map(({ _instance, ...rest }) => rest)
  }

  // ---- Insert ----

  /**
   * Insert chunks, routing each chunk to the instance that owns its filePath.
   * Chunks belonging to the same file are sent as a batch to the owning
   * instance. A chunk whose filePath matches no instance throws RouterError.
   */
  async insertChunks(chunks: VectorChunk[]): Promise<void> {
    // Group by owning instance
    const groups = new Map<string, VectorChunk[]>()
    const unowned: VectorChunk[] = []

    for (const chunk of chunks) {
      const found = this.findInstance(chunk.filePath)
      if (!found) {
        unowned.push(chunk)
        continue
      }
      const groupKey = found.config.name
      const existing = groups.get(groupKey)
      if (existing) {
        existing.push(chunk)
      } else {
        groups.set(groupKey, [chunk])
      }
    }

    if (unowned.length > 0) {
      // When only one instance exists (legacy fallback), route all unowned
      // chunks there to preserve backward compatibility with raw-data files
      // stored under dbPath/raw-data/ that are not under the user's baseDir.
      if (this.stores.size === 1) {
        const soleEntry = [...this.stores.values()][0]
        if (soleEntry) {
          const existing = groups.get(soleEntry.config.name)
          if (existing) {
            existing.push(...unowned)
          } else {
            groups.set(soleEntry.config.name, unowned)
          }
        }
      } else {
        const paths = [...new Set(unowned.map((c) => c.filePath))].join(', ')
        throw new RouterError(`No instance owns file paths: ${paths}`)
      }
    }

    for (const [name, batch] of groups) {
      const entry = this.stores.get(name)
      if (!entry) continue
      try {
        await entry.store.insertChunks(batch)
      } catch (error) {
        console.error(
          `InstanceRouter: insertChunks on instance "${name}" failed:`,
          error instanceof Error ? error.message : String(error)
        )
        throw error
      }
    }
  }

  // ---- Delete ----

  /**
   * Delete all chunks for a filePath. Routes by prefix match; if no instance
   * owns the path, tries every instance (file may have moved or the root was
   * reconfigured).
   */
  async deleteChunks(filePath: string): Promise<number> {
    const found = this.findInstance(filePath)
    if (found) {
      return found.store.deleteChunks(filePath)
    }

    let total = 0
    for (const [, entry] of this.stores) {
      try {
        total += await entry.store.deleteChunks(filePath)
      } catch (error) {
        console.error(
          `InstanceRouter: deleteChunks on instance "${entry.config.name}" failed for "${filePath}":`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    return total
  }

  // ---- Read chunks ----

  /** Get all chunks for a filePath, routed by prefix match. Falls back to sole instance for unowned paths (backward compat). */
  async getChunksByFilePath(filePath: string): Promise<VectorChunk[]> {
    const store = this.resolveStoreForPath(filePath)
    if (!store) return []
    return store.getChunksByFilePath(filePath)
  }

  /** Get chunk rows in a range for a filePath, routed by prefix match. Falls back to sole instance for unowned paths (backward compat). */
  async getChunksByRange(filePath: string, minIdx: number, maxIdx: number): Promise<ChunkRow[]> {
    const store = this.resolveStoreForPath(filePath)
    if (!store) return []
    return store.getChunksByRange(filePath, minIdx, maxIdx)
  }

  // ---- Text references ----

  /** Full-text mention search aggregated across all instances. */
  async findTextReferences(
    queryText: string,
    limit: number,
    filePathFilter?: string[]
  ): Promise<TextReferenceRow[]> {
    const results: TextReferenceRow[] = []

    for (const [, entry] of this.stores) {
      try {
        const perInstance = await entry.store.findTextReferences(queryText, limit, filePathFilter)
        results.push(...perInstance)
      } catch (error) {
        console.error(
          `InstanceRouter: findTextReferences on instance "${entry.config.name}" failed:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    return results.slice(0, limit)
  }

  /** Code-chunk metadata aggregated across all instances. */
  async getCodeChunksWithMeta(): Promise<CodeChunkMetaRow[]> {
    const results: CodeChunkMetaRow[] = []

    for (const [, entry] of this.stores) {
      try {
        const perInstance = await entry.store.getCodeChunksWithMeta()
        results.push(...perInstance)
      } catch (error) {
        console.error(
          `InstanceRouter: getCodeChunksWithMeta on instance "${entry.config.name}" failed:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    return results
  }

  // ---- Aggregation ----

  /**
   * List ingested files. When `instance` is specified, only that instance
   * is queried; otherwise results from all instances are merged.
   */
  async listFiles(instance?: string): Promise<FileInfo[]> {
    const stores = this.selectStores(instance)

    const results: FileInfo[] = []
    for (const store of stores) {
      try {
        const files = await store.listFiles()
        results.push(...files)
      } catch (error) {
        console.error(
          `InstanceRouter: listFiles failed:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    return results
  }

  /**
   * Get system status. When `instance` is specified, returns the status of
   * that single instance (with `instances` array containing just it).
   * Otherwise aggregates across all instances.
   */
  async getStatus(instance?: string): Promise<AggregatedStatus> {
    const stores = this.selectStores(instance)
    const instanceStatuses: AggregatedStatus['instances'] = []
    let totalDocs = 0
    let totalChunks = 0

    for (const store of stores) {
      try {
        const status = await store.getStatus()
        instanceStatuses.push({
          name: this.findNameByStore(store),
          documentCount: status.documentCount,
          chunkCount: status.chunkCount,
        })
        totalDocs += status.documentCount
        totalChunks += status.chunkCount
      } catch (error) {
        console.error(
          `InstanceRouter: getStatus failed:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    return {
      documentCount: totalDocs,
      chunkCount: totalChunks,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      uptime: process.uptime(),
      ftsIndexEnabled: stores.length > 0,
      searchMode: stores.length > 0 ? 'hybrid' : 'vector-only',
      instances: instanceStatuses,
    }
  }

  // ---- Broadcast ----

  /** Run optimize on every store. Failures are logged but do not propagate. */
  async optimize(): Promise<void> {
    for (const [, entry] of this.stores) {
      try {
        await entry.store.optimize()
      } catch (error) {
        console.error(
          `InstanceRouter: optimize on instance "${entry.config.name}" failed:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  /** Broadcast a partial config update to every store. */
  updateConfig(partial: RuntimeConfig): void {
    for (const [, entry] of this.stores) {
      entry.store.updateConfig(partial)
    }
  }

  // ============================================
  // Private helpers
  // ============================================

  /**
   * Find the most-specific instance that owns `filePath`. When the path
   * matches multiple baseDirs, the longest prefix wins (deepest nesting).
   * Returns null when no instance matches.
   */
  private findInstance(filePath: string): { config: InstanceConfig; store: VectorStore } | null {
    let best: { config: InstanceConfig; store: VectorStore } | null = null
    let bestLen = -1

    for (const [, entry] of this.stores) {
      const base = entry.config.baseDir
      if (isUnderOrEqual(filePath, base) && base.length > bestLen) {
        best = entry
        bestLen = base.length
      }
    }

    return best
  }

  /** Get the store for a named instance, or undefined when the name is unknown. */
  private getStore(name: string): VectorStore | undefined {
    return this.stores.get(name)?.store
  }

  /**
   * Resolve the store that should handle a filePath. Uses longest-prefix
   * matching via {@link findInstance}; when no instance matches and there is
   * exactly one store, falls back to it (backward-compatible for legacy
   * single-instance raw-data paths). Returns undefined only when multiple
   * instances are configured and none owns the path.
   */
  private resolveStoreForPath(filePath: string): VectorStore | undefined {
    const found = this.findInstance(filePath)
    if (found) return found.store
    if (this.stores.size === 1) {
      return [...this.stores.values()][0]?.store
    }
    return undefined
  }

  /**
   * Resolve the set of stores to query from an optional instance name.
   * - Name provided → single-store array (empty if name not found).
   * - No name → all stores.
   */
  private selectStores(instance?: string): VectorStore[] {
    if (instance !== undefined) {
      const store = this.getStore(instance)
      return store ? [store] : []
    }
    return [...this.stores.values()].map((e) => e.store)
  }

  /** Reverse-lookup instance name from a store reference. Used by getStatus. */
  private findNameByStore(store: VectorStore): string {
    for (const [name, entry] of this.stores) {
      if (entry.store === store) return name
    }
    return 'unknown'
  }
}

// ============================================
// Errors
// ============================================

/** Error raised by InstanceRouter for routing failures (unknown instance, unowned file). */
export class RouterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RouterError'
  }
}
