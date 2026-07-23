// read_chunk_neighbors handler

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { InstanceRouter } from '../../instances/router.js'
import type { DocumentParser } from '../../parser/index.js'
import {
  extractSourceFromPath,
  generateRawDataPath,
  looksLikeRawDataPath,
} from '../../utils/raw-data-utils.js'
import type { RagContentBlock } from '../error-utils.js'
import type { ReadChunkNeighborsInput, ReadChunkNeighborsResultItem } from '../types.js'

export interface ReadNeighborsDeps {
  instanceRouter: InstanceRouter
  parser: DocumentParser
  dbPath: string
  assertConfigOk(): void
  withWarnings(content: RagContentBlock[]): RagContentBlock[]
}

export async function handleReadChunkNeighbors(
  deps: ReadNeighborsDeps,
  args: ReadChunkNeighborsInput
): Promise<{ content: RagContentBlock[] }> {
  if (!Number.isInteger(args.chunkIndex) || args.chunkIndex < 0) {
    throw new McpError(ErrorCode.InvalidParams, 'chunkIndex must be a non-negative integer')
  }
  const before = args.before ?? 2
  if (!Number.isInteger(before) || before < 0) {
    throw new McpError(ErrorCode.InvalidParams, 'before must be a non-negative integer')
  }
  if (before > 50) {
    throw new McpError(ErrorCode.InvalidParams, `before must be between 0 and 50 (got ${before})`)
  }
  const after = args.after ?? 2
  if (!Number.isInteger(after) || after < 0) {
    throw new McpError(ErrorCode.InvalidParams, 'after must be a non-negative integer')
  }
  if (after > 50) {
    throw new McpError(ErrorCode.InvalidParams, `after must be between 0 and 50 (got ${after})`)
  }
  const hasFilePath = typeof args.filePath === 'string' && args.filePath.trim().length > 0
  const hasSource = typeof args.source === 'string' && args.source.trim().length > 0
  if (hasFilePath && hasSource) {
    throw new McpError(ErrorCode.InvalidParams, 'Provide either filePath or source, not both')
  }
  if (!hasFilePath && !hasSource) {
    throw new McpError(ErrorCode.InvalidParams, 'Either filePath or source must be provided')
  }

  let targetPath: string
  let skipValidation = false
  if (hasSource) {
    targetPath = generateRawDataPath(deps.dbPath, args.source as string, 'markdown')
    skipValidation = true
  } else {
    deps.assertConfigOk()
    targetPath = args.filePath as string
  }
  if (!skipValidation) {
    await deps.parser.validateFilePath(targetPath)
  }

  const minIdx = Math.max(0, args.chunkIndex - before)
  const maxIdx = args.chunkIndex + after
  const rows = await deps.instanceRouter.getChunksByRange(targetPath, minIdx, maxIdx)

  const isRaw = looksLikeRawDataPath(targetPath)
  const sourceForAll = isRaw ? extractSourceFromPath(targetPath) : null
  const items: ReadChunkNeighborsResultItem[] = rows.map((row) => {
    const item: ReadChunkNeighborsResultItem = {
      filePath: row.filePath,
      chunkIndex: row.chunkIndex,
      text: row.text,
      isTarget: row.chunkIndex === args.chunkIndex,
      fileTitle: row.fileTitle ?? null,
    }
    if (sourceForAll) item.source = sourceForAll
    return item
  })

  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(items, null, 2) }]),
  }
}
