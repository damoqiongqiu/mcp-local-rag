// Manage handlers — dedup_check, export_index, config

import { createHash } from 'node:crypto'
import { stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

import { Embedder } from '../../embedder/index.js'
import { resolveModel } from '../../embedder/model-registry.js'
import type { InstanceRouter } from '../../instances/router.js'
import type { RagContentBlock } from '../error-utils.js'
import type {
  ConfigInput,
  ConfigResult,
  DedupCheckInput,
  DedupCheckResult,
  ExportIndexInput,
  ExportIndexResult,
} from '../types.js'

export interface ManageDeps {
  instanceRouter: InstanceRouter
  dbPath: string
  withWarnings(content: RagContentBlock[]): RagContentBlock[]
  // Config deps
  embedder?: Embedder
  setEmbedder?(emb: Embedder): void
  modelName?: string
  setModelName?(name: string): void
  cacheDir?: string
  device?: string | undefined
  dtype?: string | undefined
}

// ---- dedup_check ----

export async function handleDedupCheck(
  deps: ManageDeps,
  args: DedupCheckInput = {}
): Promise<{ content: RagContentBlock[] }> {
  if (args.threshold !== undefined) {
    if (typeof args.threshold !== 'number' || args.threshold < 0.5 || args.threshold > 1.0) {
      throw new McpError(ErrorCode.InvalidParams, 'threshold must be a number between 0.5 and 1.0')
    }
  }
  const threshold = args.threshold ?? 0.8
  const files = await deps.instanceRouter.listFiles()

  if (files.length < 2) {
    const result: DedupCheckResult = {
      pairCount: 0,
      pairs: [],
      timestamp: new Date().toISOString(),
    }
    return {
      content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
    }
  }

  // Build per-file hash sets
  const fileHashes: Array<{ filePath: string; hashes: Set<string> }> = []
  for (const { filePath } of files) {
    const chunks = await deps.instanceRouter.getChunksByFilePath(filePath)
    const hashes = new Set<string>()
    for (const c of chunks) {
      const normalized = c.text.replace(/\s+/g, ' ').trim()
      hashes.add(createHash('sha256').update(normalized).digest('hex').substring(0, 16))
    }
    if (hashes.size > 0) fileHashes.push({ filePath, hashes })
  }

  // Compare all pairs — O(n²) but acceptable for typical index sizes
  const pairs: Array<{
    fileA: string
    fileB: string
    similarity: number
    overlappingChunks: number
    totalUniqueChunks: number
  }> = []

  for (let i = 0; i < fileHashes.length; i++) {
    const a = fileHashes[i]!
    for (let j = i + 1; j < fileHashes.length; j++) {
      const b = fileHashes[j]!
      let overlap = 0
      for (const h of a.hashes) {
        if (b.hashes.has(h)) overlap++
      }
      const union = a.hashes.size + b.hashes.size - overlap
      if (union === 0) continue
      const similarity = overlap / union
      if (similarity >= threshold) {
        pairs.push({
          fileA: a.filePath,
          fileB: b.filePath,
          similarity: Math.round(similarity * 1000) / 1000,
          overlappingChunks: overlap,
          totalUniqueChunks: union,
        })
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity)

  const result: DedupCheckResult = {
    pairCount: pairs.length,
    pairs,
    timestamp: new Date().toISOString(),
  }
  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
  }
}

// ---- export_index ----

export async function handleExportIndex(
  deps: ManageDeps,
  args: ExportIndexInput = {}
): Promise<{ content: RagContentBlock[] }> {
  if (args.outputPath !== undefined && typeof args.outputPath !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'outputPath must be a string')
  }
  const files = await deps.instanceRouter.listFiles()
  const exportData: Array<{
    filePath: string
    chunkCount: number
    timestamp: string
    chunks: Array<{ chunkIndex: number; text: string }>
  }> = []

  let totalChunks = 0
  for (const { filePath, chunkCount: fileChunkCount, timestamp } of files) {
    const chunks = await deps.instanceRouter.getChunksByFilePath(filePath)
    const chunkEntries = chunks.map((c) => ({ chunkIndex: c.chunkIndex, text: c.text }))
    totalChunks += chunkEntries.length
    exportData.push({ filePath, chunkCount: fileChunkCount, timestamp, chunks: chunkEntries })
  }

  const outputPath =
    args.outputPath ??
    resolve(deps.dbPath, `export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

  if (args.outputPath) {
    const canonicalOut = resolve(outputPath)
    const canonicalDb = resolve(deps.dbPath)
    if (canonicalOut !== canonicalDb && !canonicalOut.startsWith(canonicalDb + sep)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `export outputPath must be within the database directory (${deps.dbPath})`
      )
    }
  }

  const json = JSON.stringify(exportData, null, 2)
  await writeFile(outputPath, json, 'utf-8')
  const { size: fileSize } = await stat(outputPath)

  const result: ExportIndexResult = {
    exportPath: outputPath,
    documentCount: files.length,
    chunkCount: totalChunks,
    fileSize,
    timestamp: new Date().toISOString(),
  }
  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
  }
}

// ---- config ----

export async function handleConfig(
  deps: ManageDeps,
  args: ConfigInput = {}
): Promise<{ content: RagContentBlock[] }> {
  if (args.grouping !== undefined && args.grouping !== 'similar' && args.grouping !== 'related') {
    throw new McpError(ErrorCode.InvalidParams, 'grouping must be "similar" or "related"')
  }
  if (
    args.hybridWeight !== undefined &&
    (typeof args.hybridWeight !== 'number' || args.hybridWeight < 0 || args.hybridWeight > 1)
  ) {
    throw new McpError(ErrorCode.InvalidParams, 'hybridWeight must be a number between 0 and 1')
  }
  if (args.maxDistance !== undefined && typeof args.maxDistance !== 'number') {
    throw new McpError(ErrorCode.InvalidParams, 'maxDistance must be a number')
  }
  if (
    args.maxFiles !== undefined &&
    (typeof args.maxFiles !== 'number' || !Number.isInteger(args.maxFiles) || args.maxFiles < 1)
  ) {
    throw new McpError(ErrorCode.InvalidParams, 'maxFiles must be a positive integer')
  }
  const hasUpdates =
    args.hybridWeight !== undefined ||
    args.maxDistance !== undefined ||
    args.maxFiles !== undefined ||
    args.grouping !== undefined
  const hasModelChange = args.modelName !== undefined && args.modelName !== (deps.modelName ?? '')

  if (hasUpdates) {
    const partial: Parameters<(typeof deps)['instanceRouter']['updateConfig']>[0] = {}
    if (args.hybridWeight !== undefined) partial.hybridWeight = args.hybridWeight
    if (args.maxDistance !== undefined) partial.maxDistance = args.maxDistance
    if (args.maxFiles !== undefined) partial.maxFiles = args.maxFiles
    if (args.grouping !== undefined) partial.grouping = args.grouping as 'similar' | 'related'
    deps.instanceRouter.updateConfig(partial)
  }

  if (hasModelChange && deps.setEmbedder && deps.setModelName && deps.embedder && deps.cacheDir) {
    const resolved = resolveModel(args.modelName!)
    const newModelName = resolved.name

    await deps.embedder.dispose()

    const embedderConfig: ConstructorParameters<typeof Embedder>[0] = {
      modelPath: newModelName,
      batchSize: 16,
      cacheDir: deps.cacheDir,
    }
    if (deps.device !== undefined) embedderConfig.device = deps.device
    if (deps.dtype !== undefined) embedderConfig.dtype = deps.dtype

    const newEmbedder = new Embedder(embedderConfig)
    await newEmbedder.initialize()
    deps.setEmbedder(newEmbedder)
    deps.setModelName(newModelName)
  }

  const resolvedModelResult = resolveModel(deps.modelName ?? '')
  const result: ConfigResult = {
    hybridWeight: deps.instanceRouter.hybridWeight,
    modelName: deps.modelName ?? '',
    dbPath: deps.dbPath,
    device: deps.device ?? 'cpu',
  }
  if (resolvedModelResult.entry) {
    result.modelSizeMb = resolvedModelResult.entry.approxSizeMb
    result.modelDimension = resolvedModelResult.entry.dimension
  }
  if (hasModelChange) result.modelChanged = true
  if (deps.instanceRouter.grouping !== undefined) result.grouping = deps.instanceRouter.grouping
  if (deps.instanceRouter.maxDistance !== undefined)
    result.maxDistance = deps.instanceRouter.maxDistance
  if (deps.instanceRouter.maxFiles !== undefined) result.maxFiles = deps.instanceRouter.maxFiles
  ;(result as unknown as Record<string, unknown>)['instanceNames'] =
    deps.instanceRouter.instanceNames

  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
  }
}
