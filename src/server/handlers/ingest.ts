// Ingest handler — handleIngestFile (first of the ingest pipeline)

import { readFile } from 'node:fs/promises'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ChunkerInterface } from '../../chunker/index.js'
import { buildChunksAndEmbeddings, buildVectorChunks } from '../../ingest/compute.js'
import { prepareVisualPdfChunks } from '../../ingest/visual.js'
import type { InstanceRouter } from '../../instances/router.js'
import type { DocumentParser } from '../../parser/index.js'
import { isPathInRawDataDir, loadMetaJson } from '../../utils/raw-data-utils.js'
import type { VectorChunk } from '../../vectordb/index.js'
import { DatabaseError } from '../../vectordb/types.js'
import type { RagContentBlock } from '../error-utils.js'
import type { IngestFileInput, IngestResult } from '../types.js'

export interface IngestFileDeps {
  instanceRouter: InstanceRouter
  embedder: { embed(t: string): Promise<number[]>; embedBatch(t: string[]): Promise<number[][]> }
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
