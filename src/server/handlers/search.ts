// query_documents handler — extracted from RAGServer for modularity.
//
// This handler depends on a minimal set of server internals (embedder,
// instance router, warning attachment) and can evolve independently.

import type { Embedder } from '../../embedder/index.js'
import type { InstanceRouter } from '../../instances/router.js'
import { extractSourceFromPath, looksLikeRawDataPath } from '../../utils/raw-data-utils.js'
import type { RagContentBlock } from '../error-utils.js'
import type { LruCache } from '../lru-cache.js'
import type { QueryDocumentsInput, QueryResult } from '../types.js'

/** Dependencies required by the search handler. */
export interface SearchDeps {
  embedder: Embedder
  instanceRouter: InstanceRouter
  withWarnings(content: RagContentBlock[]): RagContentBlock[]
  /** Optional LRU cache for query results. Clear on mutation (ingest/delete/reindex). */
  queryCache?: LruCache<QueryResult[]>
}

/** Search mode presets mapped to hybrid weight overrides. */
const SEARCH_MODE_PRESETS: Record<string, { hybridWeight: number }> = {
  exact: { hybridWeight: 0.8 },
  code: { hybridWeight: 0.5 },
  doc: { hybridWeight: 0.3 },
}

/**
 * Build highlighted match contexts for query terms within chunk text.
 * Returns deduplicated, position-sorted snippets showing where query
 * terms appear in the chunk with surrounding context.
 */
function buildMatchContexts(
  text: string,
  queryTerms: readonly string[],
  contextLen: number
): Array<{ before: string; match: string; after: string }> {
  const lowerText = text.toLowerCase()
  const seen = new Set<string>()
  const contexts: Array<{ before: string; match: string; after: string }> = []

  for (const term of queryTerms) {
    const lowerTerm = term.toLowerCase()
    let pos = 0
    while (pos < lowerText.length) {
      const idx = lowerText.indexOf(lowerTerm, pos)
      if (idx === -1) break
      const key = `${idx}:${idx + term.length}`
      pos = idx + 1
      if (seen.has(key)) continue
      seen.add(key)

      const start = Math.max(0, idx - contextLen)
      const end = Math.min(text.length, idx + term.length + contextLen)
      contexts.push({
        before: text.substring(start, idx),
        match: text.substring(idx, idx + term.length),
        after: text.substring(idx + term.length, end),
      })
    }
  }

  contexts.sort((a, b) => {
    const aPos = text.indexOf(a.match)
    const bPos = text.indexOf(b.match)
    return aPos - bPos
  })
  return contexts
}

export async function handleQueryDocuments(
  deps: SearchDeps,
  args: QueryDocumentsInput
): Promise<{ content: RagContentBlock[] }> {
  // Cache key: query text + key search params that affect results
  const cacheKey = deps.queryCache
    ? `q:${args.query}|l:${args.limit ?? 10}|s:${args.scope ?? ''}|i:${args.instance ?? ''}|hc:${args.highlightContext ?? 0}|m:${args.searchMode ?? ''}`
    : undefined

  if (cacheKey) {
    const cached = deps.queryCache!.get(cacheKey)
    if (cached) {
      const content: RagContentBlock[] = [{ type: 'text', text: JSON.stringify(cached, null, 2) }]
      return { content: deps.withWarnings(content) }
    }
  }

  const queryVector = await deps.embedder.embed(args.query)

  // Apply search mode preset — updates instance config persistently
  const preset = args.searchMode ? SEARCH_MODE_PRESETS[args.searchMode] : undefined
  if (preset) {
    deps.instanceRouter.updateConfig(preset)
  }

  const searchResults = await deps.instanceRouter.search(queryVector, {
    queryText: args.query,
    limit: args.limit ?? 10,
    ...(args.instance !== undefined ? { instance: args.instance } : {}),
    ...(args.scope !== undefined
      ? { scope: Array.isArray(args.scope) ? args.scope : [args.scope] }
      : {}),
  })

  const highlightLen = args.highlightContext ?? 0
  const queryTerms =
    highlightLen > 0
      ? args.query
          .split(/[\s,，。.、；;：:！!？?()（）[\]【】"“”'‘’]+/)
          .filter((t) => t.length >= 2)
      : []

  const results: QueryResult[] = searchResults.map((result) => {
    const queryResult: QueryResult = {
      filePath: result.filePath,
      chunkIndex: result.chunkIndex,
      text: result.text,
      score: result.score,
      fileTitle: result.fileTitle ?? null,
    }

    if (looksLikeRawDataPath(result.filePath)) {
      const source = extractSourceFromPath(result.filePath)
      if (source) {
        queryResult.source = source
      }
    }

    if (highlightLen > 0 && queryTerms.length > 0) {
      queryResult.matchContext = buildMatchContexts(result.text, queryTerms, highlightLen)
    }

    return queryResult
  })

  // Store in cache for subsequent identical queries
  if (cacheKey) {
    deps.queryCache!.set(cacheKey, results)
  }

  const content: RagContentBlock[] = [{ type: 'text', text: JSON.stringify(results, null, 2) }]

  return { content: deps.withWarnings(content) }
}
