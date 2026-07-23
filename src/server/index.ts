// RAGServer implementation with MCP tools

import { watch } from 'node:fs'
import { resolve, sep } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { CodeChunker, isCodeChunkExtension } from '../chunker/code-chunker.js'
import type { ChunkerInterface } from '../chunker/index.js'
import { DEFAULT_MIN_CHUNK_LENGTH, SemanticChunker } from '../chunker/index.js'
import { Embedder } from '../embedder/index.js'
import { buildChunksAndEmbeddings, buildVectorChunks } from '../ingest/compute.js'
import { InstanceRouter } from '../instances/router.js'
import type { InstanceConfig } from '../instances/types.js'
import { parseHtml } from '../parser/html-parser.js'
import { DocumentParser } from '../parser/index.js'
import { extractMarkdownTitle, extractTxtTitle } from '../parser/title-extractor.js'
import type { BaseDirsConfigError } from '../utils/base-dirs.js'
import { loadGitignore, noopFilter } from '../utils/gitignore.js'
import {
  type ContentFormat,
  generateMetaJsonPath,
  isPathInRawDataDir,
  loadMetaJson,
  looksLikeRawDataPath,
  saveMetaJson,
  saveRawData,
} from '../utils/raw-data-utils.js'
import type { VectorChunk } from '../vectordb/index.js'
import { DatabaseError } from '../vectordb/types.js'
import {
  appendConfigWarnings,
  logError,
  type RagContentBlock,
  type ToMcpErrorContext,
  toMcpError,
} from './error-utils.js'
import { handleDeleteFile } from './handlers/delete.js'
import { handleIngestData, handleIngestDirectory, handleIngestFile, handleReindexAll, handleReindexStale, ingestFileCore } from './handlers/ingest.js'
import { handleListFiles } from './handlers/list.js'
import { handleConfig, handleDedupCheck, handleExportIndex } from './handlers/manage.js'
import { handleReadChunkNeighbors } from './handlers/read-neighbors.js'
import { handleQueryDocuments } from './handlers/search.js'
import { handleHealthCheck, handleStatus } from './handlers/system.js'
import { normalizeBaseDirs, scanBaseDir } from './list-scanner.js'
import { LruCache } from './lru-cache.js'
import { toolDefinitions } from './tool-definitions.js'
import {
  parseIngestDataInput,
  parseListFilesInput,
  parseQueryDocumentsInput,
} from './tool-input.js'
import type {
  ConfigInput,
  DedupCheckInput,
  DefinitionMatch,
  DeleteFileInput,
  ExportIndexInput,
  FindDefinitionInput,
  FindDefinitionResult,
  FindReferencesInput,
  FindReferencesResult,
  IngestDataInput,
  IngestDirectoryInput,
  IngestDirectoryResult,
  IngestFileInput,
  IngestResult,
  ListFilesInput,
  QueryDocumentsInput,
  QueryResult,
  RAGServerConfig,
  ReadChunkNeighborsInput,
  ReadChunkNeighborsResultItem,
  ReferenceMatch,
  ReindexAllInput,
  ReindexAllResult,
} from './types.js'

/**
 * Per-tool client-message policy consumed by the central dispatcher mapper
 * (`toMcpError(error, context)`). The `prefix`, when present, is prepended to
 * the controlled client message ONLY for native / non-`AppError` failures; a
 * recognized `AppError` (e.g. `DatabaseError`, `EmbeddingError`) always keeps
 * its own raw message regardless of the prefix (see `toMcpError`). This table
 * is the single source of truth for the Contract-Delta per-handler policy:
 * - `ingest_file` / `ingest_data` / `delete_file` / `read_chunk_neighbors`
 *   prepend an operation prefix on native errors.
 * - `query_documents` / `list_files` / `status` are prefix-less.
 */
const TOOL_ERROR_CONTEXT: Record<string, ToMcpErrorContext> = {
  ingest_file: { prefix: 'Failed to ingest file' },
  ingest_data: { prefix: 'Failed to ingest data' },
  ingest_directory: { prefix: 'Failed to ingest directory' },
  delete_file: { prefix: 'Failed to delete file' },
  read_chunk_neighbors: { prefix: 'Failed to read chunk neighbors' },
  reindex_stale: { prefix: 'Failed to reindex stale files' },
  reindex_all: { prefix: 'Failed to reindex all files' },
  config: { prefix: 'Failed to update config' },
  export_index: { prefix: 'Failed to export index' },
  dedup_check: { prefix: 'Failed to check duplicates' },
  find_definition: { prefix: 'Failed to find definition' },
  find_references: { prefix: 'Failed to find references' },
  query_documents: {},
  list_files: {},
  status: {},
  health_check: { prefix: 'Health check failed' },
}

/** RAG server compliant with MCP Protocol */
export class RAGServer {
  private readonly server: Server
  private readonly instanceRouter: InstanceRouter
  private embedder: Embedder
  private readonly chunker: ChunkerInterface
  private readonly parser: DocumentParser
  private readonly dbPath: string
  /**
   * One or more allowed document base directories — REALPATH-normalized
   * (the validation/security domain). Passed to `DocumentParser` as the
   * security boundary. NOT used for `list_files` scanning/display; that uses
   * the NORMAL-path `rawBaseDirs` below. Normalized from either the legacy
   * `{ baseDir }` config shape or the new `{ baseDirs }` shape so downstream
   * readers do not need to branch on shape.
   */
  private readonly baseDirs: readonly string[]
  /**
   * Normal-path (resolve()) roots, index-aligned with `baseDirs`, for
   * user-facing `list_files` scan/display. Falls back to `baseDirs` for legacy
   * `{ baseDir }` callers. See {@link BaseDirsConfig} for the path policy.
   */
  private readonly rawBaseDirs: readonly string[]
  /** Legacy single-root accessor for `rawBaseDirs`. Derived from `rawBaseDirs[0]`. */
  private readonly rawBaseDir: string
  private readonly cacheDir: string
  // Used by handleListFiles filter to exclude system-managed directories
  private readonly excludePaths: string[]
  private readonly configWarnings: string[]
  /**
   * Structured base-dirs resolution error. When non-null, the server is in
   * degraded mode: `status` remains callable so the user can diagnose the
   * problem via MCP, while root-dependent tools should surface this error
   * before doing DB or filesystem work. See `resolveBaseDirs` for the error
   * semantics.
   */
  private readonly configError: BaseDirsConfigError | null
  private readonly minChunkLength: number
  private readonly device: string | undefined
  /** Embedding model name / path */
  private modelName: string
  /** Embedding quantization dtype */
  private readonly dtype: string | undefined
  /** LRU cache for query results, invalidated on any mutation */
  private readonly queryCache = new LruCache<QueryResult[]>({ maxSize: 128, ttlMs: 5 * 60 * 1000 })

  constructor(config: RAGServerConfig) {
    this.dbPath = config.dbPath
    // Normalize both config shapes into a single `baseDirs: string[]` plus the
    // legacy single-root accessor. See `normalizeBaseDirs` for the degraded-
    // mode and misuse semantics.
    const { baseDirs, baseDir } = normalizeBaseDirs(config)
    this.baseDirs = baseDirs
    // Normal-path roots for user-facing scanning; fall back to the realpath'd
    // roots for legacy `{ baseDir }` callers.
    const rawBaseDirs = config.rawBaseDirs !== undefined ? [...config.rawBaseDirs] : [...baseDirs]
    this.rawBaseDirs = rawBaseDirs
    this.rawBaseDir = rawBaseDirs[0] ?? baseDir
    this.cacheDir = config.cacheDir
    this.configWarnings = config.configWarnings ?? []
    this.configError = config.configError ?? null
    this.minChunkLength = config.chunkMinLength ?? DEFAULT_MIN_CHUNK_LENGTH
    this.device = config.device
    this.modelName = config.modelName
    this.dtype = config.dtype
    this.excludePaths = [`${resolve(this.dbPath)}${sep}`, `${resolve(this.cacheDir)}${sep}`]
    this.server = new Server(
      { name: 'rag-mcp-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )

    // Component initialization
    const instances: InstanceConfig[] =
      config.instances && config.instances.length > 0
        ? config.instances
        : [
            {
              name: 'default',
              baseDir: this.baseDirs[0] ?? '',
              dbPath: config.dbPath,
              rawBaseDir: this.rawBaseDir,
            },
          ]
    this.instanceRouter = new InstanceRouter(instances)

    // Apply quality filter settings to all instances
    const runtimeConfig: Parameters<typeof this.instanceRouter.updateConfig>[0] = {}
    if (config.maxDistance !== undefined) runtimeConfig.maxDistance = config.maxDistance
    if (config.grouping !== undefined) runtimeConfig.grouping = config.grouping
    if (config.hybridWeight !== undefined) runtimeConfig.hybridWeight = config.hybridWeight
    if (config.maxFiles !== undefined) runtimeConfig.maxFiles = config.maxFiles
    if (Object.keys(runtimeConfig).length > 0) {
      this.instanceRouter.updateConfig(runtimeConfig)
    }
    const embedderConfig: ConstructorParameters<typeof Embedder>[0] = {
      modelPath: config.modelName,
      batchSize: 16,
      cacheDir: config.cacheDir,
    }
    if (config.device !== undefined) {
      embedderConfig.device = config.device
    }
    if (config.dtype !== undefined) {
      embedderConfig.dtype = config.dtype
    }
    if (config.remoteHost !== undefined) {
      embedderConfig.remoteHost = config.remoteHost
    }
    if (config.proxy !== undefined) {
      embedderConfig.proxy = config.proxy
    }
    if (config.autoMirror !== undefined) {
      embedderConfig.autoMirror = config.autoMirror
    }
    this.embedder = new Embedder(embedderConfig)
    this.chunker = new SemanticChunker(
      config.chunkMinLength !== undefined ? { minChunkLength: config.chunkMinLength } : {}
    )
    // Always construct the parser with the multi-root shape — the parser
    // accepts a single-element `baseDirs` array as the byte-equivalent of
    // the legacy `baseDir` shape, so passing `this.baseDirs` covers both
    // config inputs without branching here.
    this.parser = new DocumentParser({
      baseDirs: this.baseDirs,
      maxFileSize: config.maxFileSize,
    })

    this.setupHandlers()
  }

  /**
   * Fail-fast guard for root-dependent tools. When a {@link BaseDirsConfigError}
   * is stored on the instance the server is in degraded mode (invalid
   * `BASE_DIRS` — see `resolveBaseDirs`) and every root-dependent tool MUST
   * reject BEFORE any DB / embedder / parser access so the user sees the
   * configuration problem unambiguously. Throws the stored
   * {@link BaseDirsConfigError} (kind `config`) so the central dispatcher
   * mapper renders it as `McpError(InvalidParams)` — error→code ownership
   * stays in exactly one place instead of being hand-built here.
   *
   * `status` deliberately does NOT call this helper; it remains callable in
   * degraded mode and exposes the error via a diagnostic content block so
   * the user can recover via MCP without inspecting stderr.
   */
  private assertConfigOk(): void {
    if (this.configError !== null) {
      throw this.configError
    }
  }

  /**
   * Return the appropriate chunker for `filePath`.
   *
   * Code files (extensions supported by tree-sitter) get a CodeChunker
   * that splits at AST-level semantic boundaries and enriches each
   * chunk with scope-chain context for embedding. All other files
   * use the shared SemanticChunker (Max-Min sentence-level chunking).
   *
   * CodeChunker is constructed per-call (cheap — no model load); the
   * SemanticChunker is the singleton instance stored on the server.
   */
  private resolveChunker(filePath: string): ChunkerInterface {
    if (isCodeChunkExtension(filePath)) {
      return new CodeChunker(filePath, {
        maxChunkSize: 1500,
        contextMode: 'full',
        siblingDetail: 'signatures',
      })
    }
    return this.chunker
  }

  /**
   * Append the centralized config-warning blocks to a handler response.
   * Every tool handler funnels through this method so the warning shape
   * stays in exactly one place (design-doc-mandated countermeasure for the
   * "warning shape changes touch many handlers" risk).
   */
  private withWarnings(content: RagContentBlock[]): RagContentBlock[] {
    return appendConfigWarnings(content, this.configWarnings)
  }

  /**
   * Send a `notifications/progress` update to the client when a
   * progressToken was provided. No-op when no token is set.
   */
  private sendProgress(
    progressToken: string | undefined,
    progress: number,
    total: number,
    message?: string
  ): void {
    if (!progressToken) return
    this.server
      .notification({
        method: 'notifications/progress',
        params: { progressToken, progress, total, ...(message ? { message } : {}) },
      })
      .catch(() => {
        // Best-effort; never let a progress send failure break the main flow.
      })
  }

  /**
   * Set up MCP handlers
   */

  private get deps() {
    return {
      instanceRouter: this.instanceRouter,
      embedder: this.embedder as any,
      parser: this.parser,
      chunker: this.chunker,
      resolveChunker: this.resolveChunker.bind(this),
      dbPath: this.dbPath,
      cacheDir: this.cacheDir,
      device: this.device,
      modelName: this.modelName,
      minChunkLength: this.minChunkLength,
      configError: this.configError as any,
      configWarnings: this.configWarnings,
      assertConfigOk: this.assertConfigOk.bind(this),
      withWarnings: this.withWarnings.bind(this),
      sendProgress: this.sendProgress.bind(this),
    }
  }
  private setupHandlers(): void {
    // Tool list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }))

    // Tool invocation. The handlers are gutted of error mapping — every error
    // they throw (with its ORIGINAL identity) is routed through the single
    // central catch below, which logs the full cause chain to stderr and maps
    // the error to an `McpError` for the client via `toMcpError(error,
    // context)`. The per-tool `context` (see `TOOL_ERROR_CONTEXT`) encodes each
    // handler's client-message prefix policy so the Contract-Delta per-handler
    // table is preserved in exactly one place.
    this.server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
      const toolName = request.params.name
      const meta = request.params._meta
      const progressToken =
        meta && typeof meta === 'object'
          ? ((meta as Record<string, unknown>)['progressToken'] as string | undefined)
          : undefined
      try {
        switch (toolName) {
          case 'query_documents':
            return await this.handleQueryDocuments(
              parseQueryDocumentsInput(request.params.arguments)
            )
          case 'ingest_file': {
            const result = await handleIngestFile(
              {
                instanceRouter: this.instanceRouter,
                embedder: this.embedder as any,
                parser: this.parser,
                resolveChunker: this.resolveChunker.bind(this),
                dbPath: this.dbPath,
                cacheDir: this.cacheDir,
                device: this.device,
                minChunkLength: this.minChunkLength,
                assertConfigOk: this.assertConfigOk.bind(this),
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as IngestFileInput
            )
            this.queryCache.clear()
            return result
          }
          case 'ingest_data': {
            const result = await this.handleIngestData(
              parseIngestDataInput(request.params.arguments)
            )
            this.queryCache.clear()
            return result
          }
          case 'delete_file': {
            const result = await handleDeleteFile(
              {
                instanceRouter: this.instanceRouter,
                parser: this.parser,
                dbPath: this.dbPath,
                withWarnings: this.withWarnings.bind(this),
                assertConfigOk: this.assertConfigOk.bind(this),
              },
              request.params.arguments as unknown as DeleteFileInput
            )
            this.queryCache.clear()
            return result
          }
          case 'read_chunk_neighbors':
            return await handleReadChunkNeighbors(
              {
                instanceRouter: this.instanceRouter,
                parser: this.parser,
                dbPath: this.dbPath,
                assertConfigOk: this.assertConfigOk.bind(this),
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as ReadChunkNeighborsInput
            )
          case 'list_files':
            return await handleListFiles(
              {
                instanceRouter: this.instanceRouter,
                rawBaseDirs: this.rawBaseDirs,
                rawBaseDir: this.rawBaseDir,
                excludePaths: this.excludePaths,
                assertConfigOk: this.assertConfigOk.bind(this),
                withWarnings: this.withWarnings.bind(this),
              },
              parseListFilesInput(request.params.arguments)
            )
          case 'status':
            return await handleStatus(
              {
                instanceRouter: this.instanceRouter,
                embedder: this.embedder,
                dbPath: this.dbPath,
                cacheDir: this.cacheDir,
                device: this.device,
                modelName: this.modelName,
                dtype: this.dtype,
                configError: this.configError,
                rawBaseDirs: this.rawBaseDirs,
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as { instance?: string }
            )
          case 'ingest_directory': {
            const result = await this.handleIngestDirectory(
              request.params.arguments as unknown as IngestDirectoryInput,
              progressToken
            )
            this.queryCache.clear()
            return result
          }
          case 'reindex_stale': {
            const result = await this.handleReindexStale(progressToken)
            this.queryCache.clear()
            return result
          }
          case 'reindex_all': {
            const result = await this.handleReindexAll(
              request.params.arguments as unknown as { optimizeAfter?: boolean },
              progressToken
            )
            this.queryCache.clear()
            return result
          }
          case 'config': {
            const result = await handleConfig(
              {
                instanceRouter: this.instanceRouter,
                dbPath: this.dbPath,
                withWarnings: this.withWarnings.bind(this),
                embedder: this.embedder,
                setEmbedder: (emb: Embedder) => {
                  this.embedder = emb
                },
                modelName: this.modelName,
                setModelName: (name: string) => {
                  this.modelName = name
                },
                cacheDir: this.cacheDir,
                device: this.device,
                dtype: this.dtype,
              },
              request.params.arguments as unknown as ConfigInput
            )
            this.queryCache.clear()
            return result
          }
          case 'export_index':
            return await handleExportIndex(
              {
                instanceRouter: this.instanceRouter,
                dbPath: this.dbPath,
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as ExportIndexInput
            )
          case 'dedup_check':
            return await handleDedupCheck(
              {
                instanceRouter: this.instanceRouter,
                dbPath: this.dbPath,
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as DedupCheckInput
            )
          case 'find_definition':
            return await this.handleFindDefinition(
              request.params.arguments as unknown as FindDefinitionInput
            )
          case 'find_references':
            return await this.handleFindReferences(
              request.params.arguments as unknown as FindReferencesInput
            )
          case 'health_check':
            return await handleHealthCheck({
              instanceRouter: this.instanceRouter,
              embedder: this.embedder,
              dbPath: this.dbPath,
              cacheDir: this.cacheDir,
              device: this.device,
              modelName: this.modelName,
              dtype: this.dtype,
              configError: this.configError,
              rawBaseDirs: this.rawBaseDirs,
              withWarnings: this.withWarnings.bind(this),
            })
          default:
            throw new Error(`Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const context = TOOL_ERROR_CONTEXT[toolName] ?? {}
        logError(toolName, error)
        throw toMcpError(error, context)
      }
    })
  }

  /**
   * Initialization
   */
  async initialize(): Promise<void> {
    await this.instanceRouter.initialize()
    console.error('RAGServer initialized')
  }

  /**
   * query_documents tool handler
   */
  async handleQueryDocuments(args: QueryDocumentsInput): Promise<{ content: RagContentBlock[] }> {
    return handleQueryDocuments(
      {
        embedder: this.embedder,
        instanceRouter: this.instanceRouter,
        withWarnings: this.withWarnings.bind(this),
        queryCache: this.queryCache,
      },
      args
    )
  }

  /**
   * ingest_file tool handler (re-ingestion support, transaction processing, rollback capability)
   */
  async handleIngestFile(args: IngestFileInput): Promise<{ content: RagContentBlock[] }> {
    return handleIngestFile(
      {
        instanceRouter: this.instanceRouter,
        embedder: this.embedder as any,
        parser: this.parser,
        resolveChunker: this.resolveChunker.bind(this),
        dbPath: this.dbPath,
        cacheDir: this.cacheDir,
        device: this.device,
        minChunkLength: this.minChunkLength,
        assertConfigOk: this.assertConfigOk.bind(this),
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * ingest_data tool handler
   * Saves raw content to raw-data directory and calls handleIngestFile internally
   *
   * For HTML content:
   * - Parses HTML and extracts main content using Readability
   * - Converts to Markdown for better chunking
   * - Saves as .md file
   */
  async handleIngestData(...args: any[]): Promise<any> {
    return handleIngestData(this.deps as any, ...args as [any])
  }

  /**
   * list_files tool handler
   *
   * Scans the normal-path roots (`this.rawBaseDirs`) so scanned paths match the
   * resolve()-stored DB keys (see {@link BaseDirsConfig} for the path policy).
   *
   * Scans every effective base directory (`this.rawBaseDirs`) for supported
   * files and cross-references with ingested documents. Multi-root contract:
   * - Returns top-level `baseDirs` (all effective roots in normal-path space,
   *   nested-root-pruned by `resolveBaseDirs`).
   * - Preserves legacy top-level `baseDir = rawBaseDirs[0]` for clients written
   *   against the single-root shape.
   * - Annotates each file entry with the producing `baseDir`.
   * - De-duplicates exact duplicate file paths across roots (first occurrence
   *   wins, preserving root iteration order).
   * - Preserves raw-data / orphaned DB entries under `sources` with no
   *   producing-root annotation.
   * - Excludes `dbPath` and `cacheDir` uniformly across every root.
   */
  async handleListFiles(input: ListFilesInput = {}): Promise<{ content: RagContentBlock[] }> {
    return handleListFiles(
      {
        instanceRouter: this.instanceRouter,
        rawBaseDirs: this.rawBaseDirs,
        rawBaseDir: this.rawBaseDir,
        excludePaths: this.excludePaths,
        assertConfigOk: this.assertConfigOk.bind(this),
        withWarnings: this.withWarnings.bind(this),
      },
      input
    )
  }

  /**
   * status tool handler
   */
  async handleStatus(args: { instance?: string } = {}): Promise<{ content: RagContentBlock[] }> {
    return handleStatus(
      {
        instanceRouter: this.instanceRouter,
        embedder: this.embedder,
        dbPath: this.dbPath,
        cacheDir: this.cacheDir,
        device: this.device,
        modelName: this.modelName,
        dtype: this.dtype,
        configError: this.configError,
        rawBaseDirs: this.rawBaseDirs,
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * health_check tool handler
   *
   * Proactively diagnoses common failure points: embedder, LanceDB, BASE_DIRs,
   * and model cache. Returns structured pass/fail with a human-readable summary
   * and per-check fix suggestions. Unlike `status`, this actively probes the
   * system rather than just dumping stored metadata.
   */
  async handleHealthCheck(): Promise<{ content: RagContentBlock[] }> {
    return handleHealthCheck({
      instanceRouter: this.instanceRouter,
      embedder: this.embedder,
      dbPath: this.dbPath,
      cacheDir: this.cacheDir,
      device: this.device,
      modelName: this.modelName,
      dtype: this.dtype,
      configError: this.configError,
      rawBaseDirs: this.rawBaseDirs,
      withWarnings: this.withWarnings.bind(this),
    })
  }

  /**
   * ingest_directory tool handler
   *
   * Batch ingests all supported files inside a directory by delegating to
   * `ingestFileCore`. Reuses the parse→chunk→embed→insert pipeline from
   * `handleIngestFile` but without per-file backup/optimize, and with a
   * single `optimize()` call after all files are processed.
   */
  async handleIngestDirectory(...args: any[]): Promise<any> {
    return handleIngestDirectory(this.deps as any, ...args as [any])
  }

  /**
   * Core file ingestion without backup/optimize (used by ingest_directory
   * for batch processing). Parse → chunk → embed → delete → insert.
   * Returns a per-file summary; does NOT optimize the FTS index.
   */
  private async ingestFileCore(...args: any[]): Promise<any> {
    return ingestFileCore(this.deps as any, ...args as [any])
  }

  /**
   * reindex_stale tool handler
   *
   * Finds all ingested files whose mtime on disk is newer than their last
   * ingestion timestamp, and re-ingests them. Uses the same per-file pipeline
   * as ingest_directory (no per-file optimize, single optimize at end).
   */
  async handleReindexStale(...args: any[]): Promise<any> {
    return handleReindexStale(this.deps as any, ...args as [any])
  }

  /**
   * delete_file tool handler
   * Deletes chunks from VectorDB and physical raw-data files
   * Supports both filePath (for ingest_file) and source (for ingest_data)
   */
  async handleDeleteFile(args: DeleteFileInput): Promise<{ content: RagContentBlock[] }> {
    return handleDeleteFile(
      {
        instanceRouter: this.instanceRouter,
        parser: this.parser,
        dbPath: this.dbPath,
        withWarnings: this.withWarnings.bind(this),
        assertConfigOk: this.assertConfigOk.bind(this),
      },
      args
    )
  }

  /**
   * read_chunk_neighbors tool handler
   * Returns chunks around a target chunkIndex within a single ingested document.
   * Context-expansion utility — not a search tool. Mirrors handleDeleteFile's
   * dual-input (filePath XOR source) resolution pattern.
   */
  async handleReadChunkNeighbors(
    args: ReadChunkNeighborsInput
  ): Promise<{ content: RagContentBlock[] }> {
    return handleReadChunkNeighbors(
      {
        instanceRouter: this.instanceRouter,
        parser: this.parser,
        dbPath: this.dbPath,
        assertConfigOk: this.assertConfigOk.bind(this),
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * reindex_all tool handler
   * Re-ingests every file currently in the index from scratch.
   * Skips raw-data (ingest_data) entries since they have no disk file.
   */
  async handleReindexAll(...args: any[]): Promise<any> {
    return handleReindexAll(this.deps as any, ...args as [any])
  }

  /**
   * config tool handler
   * Read or update runtime configuration.
   */
  async handleConfig(args: ConfigInput = {}): Promise<{ content: RagContentBlock[] }> {
    return handleConfig(
      {
        instanceRouter: this.instanceRouter,
        dbPath: this.dbPath,
        withWarnings: this.withWarnings.bind(this),
        embedder: this.embedder,
        setEmbedder: (emb: Embedder) => {
          this.embedder = emb
        },
        modelName: this.modelName,
        setModelName: (name: string) => {
          this.modelName = name
        },
        cacheDir: this.cacheDir,
        device: this.device,
        dtype: this.dtype,
      },
      args
    )
  }

  /**
   * export_index tool handler
   * Export all indexed chunks to a JSON file for backup/migration.
   */
  async handleExportIndex(args: ExportIndexInput = {}): Promise<{ content: RagContentBlock[] }> {
    return handleExportIndex(
      {
        instanceRouter: this.instanceRouter,
        dbPath: this.dbPath,
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * dedup_check tool handler
   * Detect near-duplicate documents by comparing chunk-content hashes.
   */
  async handleDedupCheck(args: DedupCheckInput = {}): Promise<{ content: RagContentBlock[] }> {
    return handleDedupCheck(
      {
        instanceRouter: this.instanceRouter,
        dbPath: this.dbPath,
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * find_definition tool handler.
   *
   * Searches AST-level entity metadata (extracted by CodeChunker during
   * ingestion) for the definition of a symbol. Matches against `entities`
   * (exact name match on defined entities) and falls back to `scope` when
   * no entity match is found (the symbol might be a parameter or local
   * variable captured only in the scope chain).
   */
  async handleFindDefinition(args: FindDefinitionInput): Promise<{ content: RagContentBlock[] }> {
    if (typeof args.symbolName !== 'string' || args.symbolName.trim().length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'symbolName must be a non-empty string')
    }
    const { symbolName } = args

    const rows = await this.instanceRouter.getCodeChunksWithMeta()
    const matches: DefinitionMatch[] = []

    for (const row of rows) {
      const { entities, scope } = row.codeMeta
      // Check entities first (direct definitions)
      if (entities) {
        for (const entity of entities) {
          if (entity.name === symbolName) {
            matches.push({
              filePath: row.filePath,
              chunkIndex: row.chunkIndex,
              entityName: entity.name,
              entityType: entity.type,
              ...(entity.lineRange ? { lineRange: entity.lineRange } : {}),
              ...(scope && scope.length > 0 ? { scope } : {}),
            })
          }
        }
      }
      // Fallback: check scope chain (for parameters, locals, etc.)
      if (scope && entities === undefined) {
        for (const s of scope) {
          if (s.name === symbolName) {
            // Only add scope fallback if not already matched via entities
            const alreadyMatched = matches.some(
              (m) => m.filePath === row.filePath && m.chunkIndex === row.chunkIndex
            )
            if (!alreadyMatched) {
              matches.push({
                filePath: row.filePath,
                chunkIndex: row.chunkIndex,
                entityName: s.name,
                entityType: s.type,
                scope,
              })
            }
          }
        }
      }
    }

    const result: FindDefinitionResult = {
      totalMatches: matches.length,
      matches,
    }

    return {
      content: this.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
    }
  }

  /**
   * find_references tool handler.
   *
   * Two-phase reference-finding strategy:
   * 1. Import metadata scan — find chunks whose `codeMeta.imports` contain
   *    an exact-match import of `symbolName`.
   * 2. FTS text mention search — find chunks whose text contains
   *    `symbolName` via the ngram FTS index.
   *
   * Results are merged with import references first, deduplicated by
   * (filePath, chunkIndex), and capped at `limit` (default 10, max 50).
   * Each phase is independently resilient — an error in one phase does
   * not prevent results from the other.
   */
  async handleFindReferences(args: FindReferencesInput): Promise<{ content: RagContentBlock[] }> {
    if (typeof args.symbolName !== 'string' || args.symbolName.trim().length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'symbolName must be a non-empty string')
    }
    if (args.limit !== undefined && args.limit !== null) {
      if (
        typeof args.limit !== 'number' ||
        !Number.isInteger(args.limit) ||
        args.limit < 1 ||
        args.limit > 50
      ) {
        throw new McpError(ErrorCode.InvalidParams, 'limit must be an integer between 1 and 50')
      }
    }
    const { symbolName, limit = 10 } = args

    const importMatches: ReferenceMatch[] = []
    const textMatches: ReferenceMatch[] = []

    // Phase 1: import metadata scan
    try {
      const metaRows = await this.instanceRouter.getCodeChunksWithMeta()
      for (const row of metaRows) {
        const { imports } = row.codeMeta
        if (!imports) continue
        for (const imp of imports) {
          if (imp.name === symbolName) {
            importMatches.push({
              filePath: row.filePath,
              chunkIndex: row.chunkIndex,
              referenceType: 'import',
              ...(imp.source ? { importSource: imp.source } : {}),
              ...(imp.isDefault !== undefined ? { isDefault: imp.isDefault } : {}),
              ...(imp.isNamespace !== undefined ? { isNamespace: imp.isNamespace } : {}),
            })
            break // one import match per chunk
          }
        }
      }
    } catch (error) {
      // Phase 1 is best-effort — log and continue with phase 2
      logError('find_references:import-scan', error)
    }

    // Phase 2: FTS text mention search
    try {
      const textRefs = await this.instanceRouter.findTextReferences(symbolName, limit * 3)
      for (const ref of textRefs) {
        textMatches.push({
          filePath: ref.filePath,
          chunkIndex: ref.chunkIndex,
          referenceType: 'text_mention',
          context: ref.context,
        })
      }
    } catch (error) {
      // Phase 2 is best-effort — log and continue with phase 1 results
      logError('find_references:fts', error)
    }

    // Merge: imports first, deduplicate by (filePath, chunkIndex)
    const seen = new Set<string>()
    const merged: ReferenceMatch[] = []

    for (const m of importMatches) {
      const key = `${m.filePath}:${m.chunkIndex}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(m)
      }
    }

    for (const m of textMatches) {
      const key = `${m.filePath}:${m.chunkIndex}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(m)
      }
    }

    const totalMatches = merged.length
    const result: FindReferencesResult = {
      totalMatches,
      matches: merged.slice(0, limit),
    }

    return {
      content: this.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
    }
  }

  /**
   * Start file watcher on all base directories. When files change, they
   * are automatically reindexed. Debounces rapid changes (500ms window)
   * to avoid bursty reindexing from editor auto-saves.
   *
   * Uses Node.js built-in fs.watch — no external dependencies.
   */
  startFileWatcher(): void {
    if (this.baseDirs.length === 0) {
      console.error('RAGServer: File watcher has no baseDirs to watch — skipping')
      return
    }

    const pending = new Map<string, ReturnType<typeof setTimeout>>()
    const DEBOUNCE_MS = 500

    const scheduleReingest = (filePath: string): void => {
      const existing = pending.get(filePath)
      if (existing) clearTimeout(existing)

      pending.set(
        filePath,
        setTimeout(async () => {
          pending.delete(filePath)
          try {
            console.error(`RAGServer: File changed, reindexing "${filePath}"`)
            await this.ingestFileCore(filePath)
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.error(`RAGServer: Failed to reindex "${filePath}": ${msg}`)
          }
        }, DEBOUNCE_MS)
      )
    }

    for (const dir of this.baseDirs) {
      try {
        const watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
          if (!filename) return
          const filePath = resolve(dir, filename)
          if (
            filename.startsWith('.') ||
            filename.includes('node_modules') ||
            this.excludePaths.some((ex) => filePath.startsWith(ex))
          ) {
            return
          }
          scheduleReingest(filePath)
        })

        watcher.on('error', (err: Error) => {
          console.error(`RAGServer: watcher error on "${dir}":`, err.message)
        })

        console.error(`RAGServer: Watching "${dir}" for file changes`)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`RAGServer: Failed to watch "${dir}": ${msg}`)
      }
    }

    console.error(
      `RAGServer: File watcher started on ${this.baseDirs.length} director${this.baseDirs.length === 1 ? 'y' : 'ies'}`
    )
  }

  /**
   * Start the server
   */
  async run(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('RAGServer running on stdio transport')
  }

  /**
   * Stop the server and release resources
   */
  async close(): Promise<void> {
    await this.server.close()
    await this.instanceRouter.close()
    await this.embedder.dispose()
    console.error('RAGServer stopped')
  }
}
