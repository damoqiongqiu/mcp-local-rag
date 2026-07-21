// Unit tests for find_references MCP tool handler.
//
// Covers the two-phase reference-finding strategy:
//   1. Import metadata scan (getCodeChunksWithMeta)
//   2. FTS text mention search (findTextReferences)
//   3. Merge with deduplication, limit enforcement, and error resilience.
//
// Test type: unit (spy-based). We inject mock results at the VectorStore
// adapter boundary and invoke the handler directly.

import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { testModelCacheDir, withTestDevice } from '../../__tests__/test-device.js'
import type { RAGServer } from '../index.js'

// ── helpers ──────────────────────────────────────────────────────────

function makeCodeMetaRow(filePath: string, chunkIndex: number, codeMeta: Record<string, unknown>) {
  return { filePath, chunkIndex, codeMeta }
}

function makeImportEntity(
  name: string,
  overrides?: Partial<Record<string, unknown>>
): Record<string, unknown> {
  return {
    name,
    source: './utils',
    isDefault: false,
    isNamespace: false,
    ...overrides,
  }
}

function makeTextRef(filePath: string, chunkIndex: number, context: string) {
  return { filePath, chunkIndex, context }
}

// Typed accessor for RAGServer internals (parallels dispatcher-mapping test pattern).
function internals(server: RAGServer): {
  vectorStore: {
    getCodeChunksWithMeta: () => Promise<unknown[]>
    findTextReferences: () => Promise<unknown[]>
  }
} {
  return server as unknown as {
    vectorStore: {
      getCodeChunksWithMeta: () => Promise<unknown[]>
      findTextReferences: () => Promise<unknown[]>
    }
  }
}

describe('find_references handler', () => {
  let server: RAGServer
  const testDbPath = resolve('./tmp/test-lancedb-findrefs')
  const testDataDir = resolve('./tmp/test-data-findrefs')

  beforeAll(async () => {
    mkdirSync(testDbPath, { recursive: true })
    mkdirSync(testDataDir, { recursive: true })
    // Use a dynamic import to avoid triggering the full RAGServer constructor chain.
    const { RAGServer: RAGServerClass } = await import('../index.js')
    server = new RAGServerClass(
      withTestDevice({
        dbPath: testDbPath,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        cacheDir: testModelCacheDir(),
        baseDir: testDataDir,
        maxFileSize: 100 * 1024 * 1024,
      })
    )
    await server.initialize()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await server.close()
    rmSync(testDbPath, { recursive: true, force: true })
    rmSync(testDataDir, { recursive: true, force: true })
  })

  // ── Phase 1: import references ─────────────────────────────────────

  it('returns import references when codeMeta.imports contain the symbol', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([
      makeCodeMetaRow('/src/foo.ts', 0, {
        imports: [
          makeImportEntity('lodash', { source: 'lodash', isDefault: true }),
          makeImportEntity('helper', { source: './utils' }),
        ],
      }),
      makeCodeMetaRow('/src/bar.ts', 1, {
        imports: [makeImportEntity('lodash', { source: 'lodash', isNamespace: true })],
      }),
    ])
    // No text references (empty FTS)
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([])

    const result = await server.handleFindReferences({ symbolName: 'lodash' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(2)
    expect(parsed.matches.length).toBe(2)
    expect(parsed.matches[0].referenceType).toBe('import')
    expect(parsed.matches[0].filePath).toBe('/src/foo.ts')
    expect(parsed.matches[0].importSource).toBe('lodash')
    expect(parsed.matches[0].isDefault).toBe(true)
    expect(parsed.matches[1].referenceType).toBe('import')
    expect(parsed.matches[1].filePath).toBe('/src/bar.ts')
    expect(parsed.matches[1].isNamespace).toBe(true)
  })

  it('matches import by exact name only (not partial)', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([
      makeCodeMetaRow('/src/app.ts', 0, {
        imports: [
          makeImportEntity('React'),
          makeImportEntity('useState'),
          makeImportEntity('useEffect'),
        ],
      }),
    ])
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([])

    const result = await server.handleFindReferences({ symbolName: 'React' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(1)
    expect(parsed.matches[0].importSource).toBe('./utils')
  })

  it('skips import scan errors gracefully and still returns text results', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockRejectedValue(new Error('LanceDB internal error'))
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([
      makeTextRef('/src/main.ts', 2, 'text mentioning React here'),
    ])

    const result = await server.handleFindReferences({ symbolName: 'React', limit: 5 })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(1)
    expect(parsed.matches[0].referenceType).toBe('text_mention')
    expect(parsed.matches[0].context).toContain('React')
  })

  // ── Phase 2: text mentions (FTS) ───────────────────────────────────

  it('returns text mention references from FTS search', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([])
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([
      makeTextRef('/src/alpha.ts', 0, '…call helper(…'),
      makeTextRef('/src/beta.ts', 3, '…const x = helper(…'),
      makeTextRef('/src/gamma.ts', 1, '…await helper.run(…'),
    ])

    const result = await server.handleFindReferences({ symbolName: 'helper' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(3)
    expect(parsed.matches.length).toBe(3)
    for (const m of parsed.matches) {
      expect(m.referenceType).toBe('text_mention')
      expect(m.context).toBeDefined()
    }
    expect(parsed.matches[0].filePath).toBe('/src/alpha.ts')
  })

  it('skips FTS errors gracefully and still returns import results', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([
      makeCodeMetaRow('/src/imports.ts', 0, {
        imports: [makeImportEntity('fetchData', { source: './api' })],
      }),
    ])
    vi.spyOn(vs, 'findTextReferences').mockRejectedValue(new Error('FTS index missing'))

    const result = await server.handleFindReferences({ symbolName: 'fetchData' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(1)
    expect(parsed.matches[0].referenceType).toBe('import')
    expect(parsed.matches[0].filePath).toBe('/src/imports.ts')
  })

  // ── Merge & deduplication ──────────────────────────────────────────

  it('deduplicates import vs text mention on the same (filePath, chunkIndex)', async () => {
    const vs = internals(server).instanceRouter
    // Same chunk has both an import AND is found by FTS text search
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([
      makeCodeMetaRow('/src/shared.ts', 5, {
        imports: [makeImportEntity('dedup', { source: './lib' })],
      }),
    ])
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([
      makeTextRef('/src/shared.ts', 5, '…dedup(…'),
      makeTextRef('/src/other.ts', 0, '…dedup.run(…'),
    ])

    const result = await server.handleFindReferences({ symbolName: 'dedup', limit: 10 })
    const parsed = JSON.parse(result.content[0].text)

    // /src/shared.ts:5 appears once (import takes priority)
    // /src/other.ts:0 is a text mention
    expect(parsed.totalMatches).toBe(2)
    expect(parsed.matches[0].referenceType).toBe('import')
    expect(parsed.matches[0].filePath).toBe('/src/shared.ts')
    expect(parsed.matches[1].referenceType).toBe('text_mention')
    expect(parsed.matches[1].filePath).toBe('/src/other.ts')
  })

  it('prefers import references first in merged order', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([
      makeCodeMetaRow('/a.ts', 0, { imports: [makeImportEntity('order', { source: 'x' })] }),
    ])
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([
      makeTextRef('/b.ts', 0, '…order(…'),
      makeTextRef('/c.ts', 0, '…order(…'),
    ])

    const result = await server.handleFindReferences({ symbolName: 'order', limit: 10 })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(3)
    // Import always comes first
    expect(parsed.matches[0].referenceType).toBe('import')
    expect(parsed.matches[1].referenceType).toBe('text_mention')
    expect(parsed.matches[2].referenceType).toBe('text_mention')
  })

  // ── Limit enforcement ──────────────────────────────────────────────

  it('respects the limit parameter', async () => {
    const vs = internals(server).instanceRouter
    // Generate many import references
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeCodeMetaRow(`/src/file${i}.ts`, 0, {
        imports: [makeImportEntity('target', { source: `./mod${i}` })],
      })
    )
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue(rows)
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([])

    const result = await server.handleFindReferences({ symbolName: 'target', limit: 5 })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.matches.length).toBe(5)
    expect(parsed.totalMatches).toBe(20)
  })

  it('uses default limit of 10 when not specified', async () => {
    const vs = internals(server).instanceRouter
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeCodeMetaRow(`/src/file${i}.ts`, 0, {
        imports: [makeImportEntity('target', { source: `./mod${i}` })],
      })
    )
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue(rows)
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([])

    const result = await server.handleFindReferences({ symbolName: 'target' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.matches.length).toBe(10)
  })

  // ── Empty / no-results ─────────────────────────────────────────────

  it('returns empty results when no references exist', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([])
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([])

    const result = await server.handleFindReferences({ symbolName: 'nonexistent' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(0)
    expect(parsed.matches).toEqual([])
  })

  it('returns empty results when imports exist but none match', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([
      makeCodeMetaRow('/src/app.ts', 0, {
        imports: [makeImportEntity('React'), makeImportEntity('useState')],
      }),
    ])
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([])

    const result = await server.handleFindReferences({ symbolName: 'useReducer' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(0)
    expect(parsed.matches).toEqual([])
  })

  // ── Edge cases ─────────────────────────────────────────────────────

  it('handles chunks with missing imports array', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([
      makeCodeMetaRow('/src/noimports.ts', 0, { entities: [{ name: 'fn', type: 'function' }] }),
    ])
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([
      makeTextRef('/src/noimports.ts', 0, '…fn(…'),
    ])

    const result = await server.handleFindReferences({ symbolName: 'fn' })
    const parsed = JSON.parse(result.content[0].text)

    // Only text mention found (no import metadata)
    expect(parsed.totalMatches).toBe(1)
    expect(parsed.matches[0].referenceType).toBe('text_mention')
  })

  it('handles import without optional fields (source, isDefault, isNamespace)', async () => {
    const vs = internals(server).instanceRouter
    vi.spyOn(vs, 'getCodeChunksWithMeta').mockResolvedValue([
      makeCodeMetaRow('/src/minimal.ts', 0, {
        imports: [{ name: 'bare' }],
      }),
    ])
    vi.spyOn(vs, 'findTextReferences').mockResolvedValue([])

    const result = await server.handleFindReferences({ symbolName: 'bare' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.totalMatches).toBe(1)
    expect(parsed.matches[0].referenceType).toBe('import')
    expect(parsed.matches[0].filePath).toBe('/src/minimal.ts')
    // Optional fields should NOT appear in the output
    expect(parsed.matches[0].importSource).toBeUndefined()
    expect(parsed.matches[0].isDefault).toBeUndefined()
  })
})
