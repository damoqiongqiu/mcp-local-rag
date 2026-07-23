// delete_file handler

import { unlink } from 'node:fs/promises'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

import type { InstanceRouter } from '../../instances/router.js'
import type { DocumentParser } from '../../parser/index.js'
import {
  checkRawDataArtifacts,
  generateMetaJsonPath,
  generateRawDataPath,
  isEnoent,
  isPathInRawDataDirLexical,
} from '../../utils/raw-data-utils.js'
import type { RagContentBlock } from '../error-utils.js'
import type { DeleteFileInput, DeleteFileResult } from '../types.js'

export interface DeleteFileDeps {
  instanceRouter: InstanceRouter
  parser: DocumentParser
  dbPath: string
  withWarnings(content: RagContentBlock[]): RagContentBlock[]
  assertConfigOk(): void
}

export async function handleDeleteFile(
  deps: DeleteFileDeps,
  args: DeleteFileInput
): Promise<{ content: RagContentBlock[] }> {
  let targetPath: string
  let skipValidation = false

  if (args.source) {
    targetPath = generateRawDataPath(deps.dbPath, args.source, 'markdown')
    skipValidation = true
  } else if (args.filePath) {
    deps.assertConfigOk()
    targetPath = args.filePath
  } else {
    throw new McpError(ErrorCode.InvalidParams, 'Either filePath or source must be provided')
  }

  if (!skipValidation) {
    await deps.parser.validateFilePath(targetPath)
  }

  const removedChunks = await deps.instanceRouter.deleteChunks(targetPath)
  await deps.instanceRouter.optimize()

  let rawDataExisted = false
  let metaExisted = false

  if (isPathInRawDataDirLexical(targetPath, deps.dbPath)) {
    const artifacts = await checkRawDataArtifacts(targetPath)
    rawDataExisted = artifacts.rawDataExisted
    metaExisted = artifacts.metaExisted

    try {
      await unlink(targetPath)
    } catch (error: unknown) {
      if (!isEnoent(error)) throw error
    }
    try {
      await unlink(generateMetaJsonPath(targetPath))
    } catch (error: unknown) {
      if (!isEnoent(error)) throw error
    }
  }

  const result: DeleteFileResult = {
    filePath: targetPath,
    deleted: true,
    removedChunks,
    existed: removedChunks > 0 || rawDataExisted || metaExisted,
    timestamp: new Date().toISOString(),
  }

  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
  }
}
