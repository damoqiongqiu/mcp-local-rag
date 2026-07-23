// list_files handler

import { stat } from 'node:fs/promises'
import type { InstanceRouter } from '../../instances/router.js'
import { loadGitignore, noopFilter } from '../../utils/gitignore.js'
import { classifyIngestedSources } from '../../utils/list-sources.js'
import { realpathForMatch } from '../../utils/scan.js'
import { nonAbsolutePrefixes } from '../../utils/scope-match.js'
import type { RagContentBlock } from '../error-utils.js'
import { scanBaseDir } from '../list-scanner.js'
import type { FileEntry, ListFilesInput, ListFilesResult, SourceEntry } from '../types.js'

export interface ListFilesDeps {
  instanceRouter: InstanceRouter
  rawBaseDirs: readonly string[]
  rawBaseDir: string
  excludePaths: string[]
  assertConfigOk(): void
  withWarnings(content: RagContentBlock[]): RagContentBlock[]
}

export async function handleListFiles(
  deps: ListFilesDeps,
  input: ListFilesInput = {}
): Promise<{ content: RagContentBlock[] }> {
  deps.assertConfigOk()

  const scope =
    input.scope === undefined ? undefined : Array.isArray(input.scope) ? input.scope : [input.scope]

  const ingested = await deps.instanceRouter.listFiles(input.instance)
  const ingestedKeyed = await Promise.all(
    ingested.map(async (f) => ({ entry: f, key: await realpathForMatch(f.filePath) }))
  )
  const ingestedByKey = new Map(ingestedKeyed.map(({ entry, key }) => [key, entry]))

  const files: FileEntry[] = []
  const seenKeys = new Set<string>()
  const matchedKeys = new Set<string>()
  const scanWarnings: string[] = []

  for (const baseDir of deps.rawBaseDirs) {
    const gitignoreFilter = await loadGitignore(baseDir, baseDir).catch(() => noopFilter())
    const { files: scanned, warnings: rootWarnings } = await scanBaseDir(
      baseDir,
      deps.excludePaths,
      scope,
      gitignoreFilter
    )
    for (const w of rootWarnings) scanWarnings.push(`[${baseDir}] ${w}`)
    for (const scannedPath of scanned) {
      const key = await realpathForMatch(scannedPath)
      if (seenKeys.has(key)) continue
      seenKeys.add(key)
      const entry = ingestedByKey.get(key)
      files.push(
        entry
          ? {
              filePath: entry.filePath,
              baseDir,
              ingested: true as const,
              chunkCount: entry.chunkCount,
              timestamp: entry.timestamp,
            }
          : { filePath: scannedPath, baseDir, ingested: false as const }
      )
      if (entry) matchedKeys.add(key)
    }
  }

  const stalePromises = files
    .filter((f): f is FileEntry & { ingested: true } => f.ingested === true)
    .map(async (f) => {
      try {
        const s = await stat(f.filePath)
        const indexedAt = new Date(f.timestamp).getTime()
        if (s.mtimeMs > indexedAt) {
          ;(f as Record<string, unknown>)['stale'] = true
        }
      } catch {
        /* deleted — skip */
      }
    })
  await Promise.all(stalePromises)

  const sources: SourceEntry[] = classifyIngestedSources(ingestedKeyed, matchedKeys, scope)

  const result: ListFilesResult = {
    baseDir: deps.rawBaseDir,
    baseDirs: [...deps.rawBaseDirs],
    files,
    sources,
  }

  const content: RagContentBlock[] = [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  for (const w of scanWarnings) content.push({ type: 'text', text: `Warning: ${w}` })

  if (scope !== undefined) {
    for (const prefix of nonAbsolutePrefixes(scope)) {
      content.push({
        type: 'text',
        text: `Warning: scope prefix "${prefix}" is not absolute; it matches nothing.`,
      })
    }
  }

  return { content: deps.withWarnings(content) }
}
