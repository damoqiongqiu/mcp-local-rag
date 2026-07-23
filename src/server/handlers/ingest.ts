// Ingest/reindex handlers

import { readFile, stat, unlink } from 'node:fs/promises'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ChunkerInterface } from '../../chunker/index.js'
import { buildChunksAndEmbeddings, buildVectorChunks } from '../../ingest/compute.js'
import { prepareVisualPdfChunks } from '../../ingest/visual.js'
import { parseHtml } from '../../parser/html-parser.js'
import { extractMarkdownTitle, extractTxtTitle } from '../../parser/title-extractor.js'
import { loadGitignore, noopFilter } from '../../utils/gitignore.js'
import type { ContentFormat } from '../../utils/raw-data-utils.js'
import {
  generateMetaJsonPath,
  isPathInRawDataDir,
  loadMetaJson,
  looksLikeRawDataPath,
  saveMetaJson,
  saveRawData,
} from '../../utils/raw-data-utils.js'
import type { VectorChunk } from '../../vectordb/index.js'
import { DatabaseError } from '../../vectordb/types.js'
import type { RagContentBlock } from '../error-utils.js'
import { scanBaseDir } from '../list-scanner.js'
import type {
  IngestDirectoryResult,
  IngestFileInput,
  IngestResult,
  ReindexAllResult,
} from '../types.js'

export interface IngestDeps {
  instanceRouter: InstanceRouter
  embedder: {
    embed(t: string, opts?: any): Promise<number[]>
    embedBatch(t: string[]): Promise<number[][]>
  }
  parser: DocumentParser
  resolveChunker(filePath: string): ChunkerInterface
  dbPath: string
  cacheDir: string
  device?: string | undefined
  minChunkLength: number
  assertConfigOk(): void
  withWarnings(content: RagContentBlock[]): RagContentBlock[]
}

export async function handleIngestFile(
  deps: IngestFileDeps,
  args: IngestFileInput
): Promise<{ content: RagContentBlock[] }> {
  if (!(await isPathInRawDataDir(args.filePath, deps.dbPath))) {
    deps.assertConfigOk()
  }

  const visualArg: unknown = args.visual
  if (visualArg !== undefined && typeof visualArg !== 'boolean') {
    throw new McpError(ErrorCode.InvalidParams, "'visual' must be a boolean if provided")
  }

  const visualQualityArg: unknown = (args as { visualQuality?: unknown }).visualQuality
  let visualQuality: 'fast' | 'quality' = 'fast'
  if (visualQualityArg !== undefined && visualQualityArg !== '') {
    if (visualQualityArg !== 'fast' && visualQualityArg !== 'quality') {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'visualQuality' must be 'fast' or 'quality' if provided"
      )
    }
    visualQuality = visualQualityArg
  }

  let backup: VectorChunk[] | null = null

  const isPdf = args.filePath.toLowerCase().endsWith('.pdf')
  let text: string
  let title: string | null = null
  let chunks: Awaited<ReturnType<typeof buildChunksAndEmbeddings>>['chunks']
  let embeddings: Awaited<ReturnType<typeof buildChunksAndEmbeddings>>['embeddings']

  if (await isPathInRawDataDir(args.filePath, deps.dbPath)) {
    text = await readFile(args.filePath, 'utf-8')
    const meta = await loadMetaJson(args.filePath)
    title = meta?.title ?? null
    ;({ chunks, embeddings } = await buildChunksAndEmbeddings(
      text,
      title,
      deps.resolveChunker(args.filePath),
      deps.embedder
    ))
  } else if (visualArg === true && isPdf) {
    const visualResult = await prepareVisualPdfChunks(
      args.filePath,
      deps.parser,
      deps.resolveChunker(args.filePath),
      deps.embedder,
      { profile: visualQuality, cacheDir: deps.cacheDir, device: deps.device }
    )
    chunks = visualResult.chunks
    embeddings = visualResult.embeddings
    text = visualResult.text
    title = visualResult.title
  } else if (isPdf) {
    const result = await deps.parser.parsePdf(args.filePath, deps.embedder)
    text = result.content
    title = result.title || null
    ;({ chunks, embeddings } = await buildChunksAndEmbeddings(
      text,
      title,
      deps.resolveChunker(args.filePath),
      deps.embedder
    ))
  } else {
    const result = await deps.parser.parseFile(args.filePath)
    text = result.content
    title = result.title || null
    ;({ chunks, embeddings } = await buildChunksAndEmbeddings(
      text,
      title,
      deps.resolveChunker(args.filePath),
      deps.embedder
    ))
  }

  if (chunks.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `No chunks generated from file: ${args.filePath}. The file may be empty or all content was filtered (minimum ${deps.minChunkLength} characters required). Existing data has been preserved.`
    )
  }

  backup = await deps.instanceRouter.getChunksByFilePath(args.filePath)

  await deps.instanceRouter.deleteChunks(args.filePath)

  const vectorChunks = buildVectorChunks({
    filePath: args.filePath,
    chunks,
    embeddings,
    fileSize: text.length,
    fileTitle: title || null,
  })

  try {
    await deps.instanceRouter.insertChunks(vectorChunks)
    await deps.instanceRouter.optimize()
    backup = null
  } catch (insertError) {
    if (backup && backup.length > 0) {
      try {
        await deps.instanceRouter.insertChunks(backup)
        await deps.instanceRouter.optimize()
      } catch (rollbackError) {
        throw new DatabaseError(
          `Ingest failed and rollback failed for ${args.filePath}; existing data may not have been restored. Original insert error: ${(insertError as Error).message}`,
          insertError as Error
        )
      }
    }
    throw insertError
  }

  const result: IngestResult = {
    filePath: args.filePath,
    chunkCount: chunks.length,
    timestamp: new Date().toISOString(),
    fileTitle: title || null,
  }

  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
  }
}

// ---- handleIngestData ----

export async function handleIngestData(
  deps: IngestDeps,
  args: any
): Promise<{ content: RagContentBlock[] }> {
  // ingest_data writes only to `dbPath`/raw-data — it never reads from a
  // configured `baseDir`. Keeping it callable in degraded mode means a user
  // with invalid BASE_DIRS can still capture raw-data via MCP while they
  // diagnose the config error from `status`. The internal `handleIngestFile`
  // call below operates on a generated raw-data path, which routes
  // around `parser.validateFilePath`, so no baseDirs access happens.
  //
  // No outer error-mapping catch: failures propagate with original identity
  // to the central dispatcher mapper. The inner raw-data rollback try/catch
  // below is retained — it is local-effect (file cleanup) only.
  let contentToSave = args.content
  let formatToSave: ContentFormat = args.metadata.format
  let title: string | null = null

  // Per-format title extraction and content preparation
  if (args.metadata.format === 'html') {
    console.error(`Parsing HTML from: ${args.metadata.source}`)
    const { content: markdown, title: htmlTitle } = await parseHtml(
      args.content,
      args.metadata.source
    )

    if (!markdown.trim()) {
      throw new Error('Failed to extract content from HTML. The page may have no readable content.')
    }

    title = htmlTitle || null
    contentToSave = markdown
    formatToSave = 'markdown' // Save as .md file
    console.error(`Converted HTML to Markdown: ${markdown.length} characters`)
  } else if (args.metadata.format === 'markdown') {
    const result = extractMarkdownTitle(args.content, args.metadata.source)
    title = result.source !== 'filename' ? result.title : null
  } else {
    // text format
    const result = extractTxtTitle(args.content, args.metadata.source)
    title = result.source !== 'filename' ? result.title : null
  }

  // Save content to raw-data directory
  const rawDataPath = await saveRawData(
    deps.dbPath,
    args.metadata.source,
    contentToSave,
    formatToSave
  )

  // Save metadata sidecar (.meta.json) alongside the raw-data file
  await saveMetaJson(rawDataPath, {
    title,
    source: args.metadata.source,
    format: args.metadata.format,
  })

  console.error(`Saved raw data: ${args.metadata.source} -> ${rawDataPath}`)

  // Call existing ingest_file internally with rollback on failure
  try {
    return await handleIngestFile(deps, { filePath: rawDataPath })
  } catch (ingestError) {
    // Rollback: delete the raw-data file and .meta.json if ingest fails
    try {
      await unlink(rawDataPath)
      await unlink(generateMetaJsonPath(rawDataPath))
      console.error(`Rolled back raw-data file: ${rawDataPath}`)
    } catch {
      console.warn(`Failed to rollback raw-data file: ${rawDataPath}`)
    }
    throw ingestError
  }
}

// ---- handleIngestDirectory ----

export async function handleIngestDirectory(
  deps: IngestDeps,
  args: any,
  progressToken?: string
): Promise<{ content: RagContentBlock[] }> {
  deps.assertConfigOk()
  // Validate the directory is within bounds (reuse parser's validation
  // to avoid duplicating the baseDirs check). Use the resolved path for
  // subsequent scanning to close the TOCTOU window.
  const resolvedPath = await deps.parser.validateFilePath(args.path)

  // Use scanBaseDir to walk the directory (same BFS logic as list_files)
  const extFilter =
    args.extensionFilter && args.extensionFilter.length > 0
      ? new Set(args.extensionFilter.map((e: string) => e.toLowerCase().replace(/^\./, '')))
      : null

  const gitignoreFilter = await loadGitignore(resolvedPath, resolvedPath).catch(() => noopFilter())
  const { files: scannedFiles, warnings: scanWarnings } = await scanBaseDir(
    resolvedPath,
    deps.excludePaths,
    undefined,
    gitignoreFilter
  )
  const result: IngestDirectoryResult = {
    directory: resolvedPath,
    totalFiles: scannedFiles.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    totalChunks: 0,
    files: [],
    timestamp: new Date().toISOString(),
  }

  const content: RagContentBlock[] = []

  if (scannedFiles.length === 0) {
    result.files = []
    content.push({ type: 'text', text: JSON.stringify(result, null, 2) })
    for (const w of scanWarnings) {
      content.push({ type: 'text', text: `Warning: ${w}` })
    }
    // Signal 100% even for no files
    deps.sendProgress(progressToken, 1, 1, 'No files to process')
    return { content: deps.withWarnings(content) }
  }

  console.error(`ingest_directory: ${scannedFiles.length} files in ${args.path}`)

  let processed = 0
  const totalFiles = scannedFiles.length
  deps.sendProgress(progressToken, 0, totalFiles, `Starting batch ingest of ${totalFiles} files`)

  for (const filePath of scannedFiles) {
    // Extension filter (path-based for zero-stat speed)
    if (extFilter) {
      const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.') + 1)
      if (!extFilter.has(ext)) {
        processed++
        continue
      }
    }

    try {
      const fileResult = await ingestFileCore(filePath)
      result.files.push(fileResult)
      if (fileResult.status === 'ok') {
        result.succeeded++
        result.totalChunks += fileResult.chunkCount
      } else if (fileResult.status === 'skipped') {
        result.skipped++
      } else {
        result.failed++
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      result.files.push({
        filePath,
        status: 'error' as const,
        chunkCount: 0,
        error: msg,
      })
      result.failed++
      console.error(`ingest_directory: error processing ${filePath}: ${msg}`)
    }

    processed++
    // Send progress every file (updates are cheap OOB notifications)
    deps.sendProgress(progressToken, processed, totalFiles, filePath)
  }

  // Single optimize after all inserts
  deps.sendProgress(progressToken, totalFiles, totalFiles, 'Optimizing index...')
  await deps.instanceRouter.optimize()

  content.push({ type: 'text', text: JSON.stringify(result, null, 2) })
  for (const w of scanWarnings) {
    content.push({ type: 'text', text: `Warning: ${w}` })
  }
  return { content: deps.withWarnings(content) }
}

// ---- ingestFileCore ----

export async function ingestFileCore(
  deps: IngestDeps,
  filePath: string
): Promise<{ filePath: string; status: string; chunkCount: number }> {
  let text: string
  let title: string | null = null

  if (filePath.toLowerCase().endsWith('.pdf')) {
    const result = await deps.parser.parsePdf(filePath, deps.embedder)
    text = result.content
    title = result.title || null
  } else {
    const result = await deps.parser.parseFile(filePath)
    text = result.content
    title = result.title || null
  }

  const { chunks, embeddings } = await buildChunksAndEmbeddings(
    text,
    title,
    deps.resolveChunker(filePath),
    deps.embedder
  )

  if (chunks.length === 0) {
    return { filePath, status: 'skipped', chunkCount: 0 }
  }

  // Delete existing (idempotent, no backup in batch mode)
  await deps.instanceRouter.deleteChunks(filePath)

  // Insert
  const vectorChunks = buildVectorChunks({
    filePath,
    chunks,
    embeddings,
    fileSize: text.length,
    fileTitle: title || null,
  })
  await deps.instanceRouter.insertChunks(vectorChunks)

  return { filePath, status: 'ok' as const, chunkCount: chunks.length }
}

// ---- handleReindexStale ----

export async function handleReindexStale(
  deps: IngestDeps,
  progressToken?: string
): Promise<{ content: RagContentBlock[] }> {
  deps.assertConfigOk()

  // Collect all ingested files with their timestamps
  const ingested = await deps.instanceRouter.listFiles()
  const staleFiles: string[] = []

  for (const entry of ingested) {
    try {
      const s = await stat(entry.filePath)
      const mtimeMs = s.mtimeMs
      const indexedAt = new Date(entry.timestamp).getTime()
      // Stale = disk mtime is strictly newer than the ingestion timestamp
      if (mtimeMs > indexedAt) {
        staleFiles.push(entry.filePath)
      }
    } catch {}
  }

  let succeeded = 0
  let skipped = 0
  let failed = 0
  let totalChunks = 0

  if (staleFiles.length === 0) {
    deps.sendProgress(progressToken, 1, 1, 'No stale files found')
  } else {
    const total = staleFiles.length
    deps.sendProgress(progressToken, 0, total, `Reindexing ${total} stale files`)
    let processed = 0

    for (const filePath of staleFiles) {
      try {
        const fileResult = await ingestFileCore(filePath)
        if (fileResult.status === 'ok') {
          succeeded++
          totalChunks += fileResult.chunkCount
        } else if (fileResult.status === 'skipped') {
          skipped++
        } else {
          failed++
        }
      } catch (error) {
        console.error(`reindex_stale: error processing ${filePath}:`, error)
        failed++
      }
      processed++
      deps.sendProgress(progressToken, processed, total, filePath)
    }
  }

  // Single optimize after all inserts
  deps.sendProgress(progressToken, staleFiles.length, staleFiles.length, 'Optimizing index...')
  await deps.instanceRouter.optimize()

  const result = {
    staleCount: staleFiles.length,
    reindexed: succeeded,
    skipped,
    failed,
    totalChunks,
    timestamp: new Date().toISOString(),
  }

  return {
    content: deps.withWarnings([
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ]),
  }
}

// ---- handleReindexAll ----

export async function handleReindexAll(
  deps: IngestDeps,
  args: any,
  progressToken?: string
): Promise<{ content: RagContentBlock[] }> {
  deps.assertConfigOk()
  const optimizeAfter = args.optimizeAfter ?? true

  const files = await deps.instanceRouter.listFiles()
  let succeeded = 0
  let failed = 0
  let totalChunks = 0

  const total = files.length
  let processed = 0
  deps.sendProgress(progressToken, 0, total, `Reindexing all ${total} files`)

  for (const { filePath } of files) {
    // Skip raw-data entries — they have no disk file to re-ingest
    if (looksLikeRawDataPath(filePath)) {
      processed++
      continue
    }

    try {
      const fileResult = await ingestFileCore(filePath)
      if (fileResult.status === 'ok') {
        succeeded++
        totalChunks += fileResult.chunkCount
      } else {
        failed++
      }
    } catch (error) {
      console.error(`reindex_all: error processing ${filePath}:`, error)
      failed++
    }
    processed++
    deps.sendProgress(progressToken, processed, total, filePath)
  }

  if (optimizeAfter) {
    deps.sendProgress(progressToken, total, total, 'Optimizing index...')
    await deps.instanceRouter.optimize()
  }

  const result: ReindexAllResult = {
    reindexed: files.length,
    succeeded,
    failed,
    totalChunks,
    timestamp: new Date().toISOString(),
  }

  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
  }
}
