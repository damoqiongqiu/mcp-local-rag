// Code intelligence handlers — find_definition, find_references

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { InstanceRouter } from '../../instances/router.js'
import type { RagContentBlock } from '../error-utils.js'
import type {
  DefinitionMatch,
  FindDefinitionInput,
  FindDefinitionResult,
  FindReferencesInput,
  FindReferencesResult,
  ReferenceMatch,
} from '../types.js'

export interface CodeIntelDeps {
  instanceRouter: InstanceRouter
  withWarnings(content: RagContentBlock[]): RagContentBlock[]
}

// ---- find_definition ----

export async function handleFindDefinition(
  deps: CodeIntelDeps,
  args: FindDefinitionInput
): Promise<{ content: RagContentBlock[] }> {
  if (typeof args.symbolName !== 'string' || args.symbolName.trim().length === 0) {
    throw new McpError(ErrorCode.InvalidParams, 'symbolName must be a non-empty string')
  }
  const { symbolName } = args

  const rows = await deps.instanceRouter.getCodeChunksWithMeta()
  const matches: DefinitionMatch[] = []

  for (const row of rows) {
    const { entities, scope } = row.codeMeta
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
    if (scope && entities === undefined) {
      for (const s of scope) {
        if (s.name === symbolName) {
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
    matches: matches.slice(0, 20),
  }
  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
  }
}

// ---- find_references ----

export async function handleFindReferences(
  deps: CodeIntelDeps,
  args: FindReferencesInput
): Promise<{ content: RagContentBlock[] }> {
  if (typeof args.symbolName !== 'string' || args.symbolName.trim().length === 0) {
    throw new McpError(ErrorCode.InvalidParams, 'symbolName must be a non-empty string')
  }
  if (args.limit !== undefined && args.limit !== null) {
    const lim = args.limit
    if (typeof lim !== 'number' || !Number.isInteger(lim) || lim < 1 || lim > 50) {
      throw new McpError(ErrorCode.InvalidParams, 'limit must be an integer between 1 and 50')
    }
  }
  const { symbolName, limit = 10 } = args

  const importMatches: ReferenceMatch[] = []
  const textMatches: ReferenceMatch[] = []

  try {
    const metaRows = await deps.instanceRouter.getCodeChunksWithMeta()
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
          break
        }
      }
    }
  } catch (error) {
    console.error(
      'find_references:import-scan:',
      error instanceof Error ? error.message : String(error)
    )
  }

  try {
    const textRefs = await deps.instanceRouter.findTextReferences(symbolName, limit * 3)
    for (const ref of textRefs) {
      textMatches.push({
        filePath: ref.filePath,
        chunkIndex: ref.chunkIndex,
        referenceType: 'text_mention',
        context: ref.context,
      })
    }
  } catch (error) {
    console.error(
      'find_references:text-search:',
      error instanceof Error ? error.message : String(error)
    )
  }

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

  const result: FindReferencesResult = {
    totalMatches: merged.length,
    matches: merged.slice(0, limit),
  }
  return {
    content: deps.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
  }
}
