// Unit tests for InstanceRouter.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstanceConfig } from '../types.js'

let InstanceRouter: typeof import('../router.js').InstanceRouter
let RouterError: typeof import('../router.js').RouterError

// ============================================
// Mock VectorStore
// ============================================

const { mockA, mockB, VectorStoreConstructorMock } = vi.hoisted(() => {
  const mockA = {
    search: vi.fn<() => Promise<unknown[]>>(),
    insertChunks: vi.fn<() => Promise<void>>(),
    deleteChunks: vi.fn<() => Promise<number>>(),
    getChunksByFilePath: vi.fn<() => Promise<unknown[]>>(),
    getChunksByRange: vi.fn<() => Promise<unknown[]>>(),
    findTextReferences: vi.fn<() => Promise<unknown[]>>(),
    getCodeChunksWithMeta: vi.fn<() => Promise<unknown[]>>(),
    listFiles: vi.fn<() => Promise<unknown[]>>(),
    getStatus: vi.fn<() => Promise<unknown>>(),
    optimize: vi.fn<() => Promise<void>>(),
    updateConfig: vi.fn(),
    initialize: vi.fn<() => Promise<void>>(),
    close: vi.fn<() => Promise<void>>(),
  }
  const mockB = {
    search: vi.fn<() => Promise<unknown[]>>(),
    insertChunks: vi.fn<() => Promise<void>>(),
    deleteChunks: vi.fn<() => Promise<number>>(),
    getChunksByFilePath: vi.fn<() => Promise<unknown[]>>(),
    getChunksByRange: vi.fn<() => Promise<unknown[]>>(),
    findTextReferences: vi.fn<() => Promise<unknown[]>>(),
    getCodeChunksWithMeta: vi.fn<() => Promise<unknown[]>>(),
    listFiles: vi.fn<() => Promise<unknown[]>>(),
    getStatus: vi.fn<() => Promise<unknown>>(),
    optimize: vi.fn<() => Promise<void>>(),
    updateConfig: vi.fn(),
    initialize: vi.fn<() => Promise<void>>(),
    close: vi.fn<() => Promise<void>>(),
  }

  let callCount = 0
  // biome-ignore lint/complexity/useArrowFunction: must be regular function for `new` constructor call
  const VectorStoreConstructorMock = vi.fn(function () {
    const store = callCount % 2 === 0 ? mockA : mockB
    callCount++
    return store
  })

  return { mockA, mockB, VectorStoreConstructorMock }
})

beforeAll(async () => {
  vi.doMock('../../vectordb/index.js', () => ({
    VectorStore: VectorStoreConstructorMock,
  }))
  ;({ InstanceRouter, RouterError } = await import('../router.js'))
})

afterAll(() => {
  vi.doUnmock('../../vectordb/index.js')
  vi.resetModules()
})

// ============================================
// Helpers
// ============================================

function resetAllMocks() {
  for (const mock of [mockA, mockB]) {
    mock.search.mockReset().mockResolvedValue([])
    mock.insertChunks.mockReset().mockResolvedValue(undefined)
    mock.deleteChunks.mockReset().mockResolvedValue(0)
    mock.getChunksByFilePath.mockReset().mockResolvedValue([])
    mock.getChunksByRange.mockReset().mockResolvedValue([])
    mock.findTextReferences.mockReset().mockResolvedValue([])
    mock.getCodeChunksWithMeta.mockReset().mockResolvedValue([])
    mock.listFiles.mockReset().mockResolvedValue([])
    mock.getStatus.mockReset().mockResolvedValue({
      documentCount: 0,
      chunkCount: 0,
      memoryUsage: 0,
      uptime: 0,
      ftsIndexEnabled: false,
      searchMode: 'vector-only',
    })
    mock.optimize.mockReset().mockResolvedValue(undefined)
    mock.updateConfig.mockReset()
    mock.initialize.mockReset().mockResolvedValue(undefined)
    mock.close.mockReset().mockResolvedValue(undefined)
  }

  VectorStoreConstructorMock.mockReset()
  let callCount = 0
  // biome-ignore lint/complexity/useArrowFunction: must be regular function for `new` constructor call
  VectorStoreConstructorMock.mockImplementation(function () {
    const store = callCount % 2 === 0 ? mockA : mockB
    callCount++
    return store
  })
}

beforeEach(() => {
  resetAllMocks()
})

function makeConfig(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return {
    name: 'app-a',
    baseDir: '/tmp/app-a/',
    dbPath: '/tmp/db-a',
    rawBaseDir: '/tmp/app-a',
    ...overrides,
  }
}

function makeRouter(): InstanceRouter {
  return new InstanceRouter([
    makeConfig({ name: 'app-a', baseDir: '/tmp/app-a/', dbPath: '/tmp/db-a' }),
    makeConfig({ name: 'app-b', baseDir: '/tmp/app-b/', dbPath: '/tmp/db-b' }),
  ])
}

function makeChunk(filePath: string): {
  id: string
  filePath: string
  chunkIndex: number
  text: string
  vector: number[]
  metadata: { fileName: string; fileSize: number; fileType: string }
  fileTitle: null
  timestamp: string
} {
  return {
    id: '1',
    filePath,
    chunkIndex: 0,
    text: 'test',
    vector: [0.1],
    metadata: { fileName: 'f.ts', fileSize: 100, fileType: 'ts' },
    fileTitle: null,
    timestamp: '2024-01-01',
  }
}

function sampleResult(filePath: string, score = 0.1) {
  return {
    filePath,
    chunkIndex: 0,
    text: 'sample',
    score,
    metadata: { fileName: 'f.ts', fileSize: 100, fileType: 'ts' },
    fileTitle: null,
  }
}

// ============================================
// Tests
// ============================================

describe('InstanceRouter', () => {
  // ---- Initialization ----

  it('initializes all instance stores', async () => {
    const router = makeRouter()
    await router.initialize()
    expect(mockA.initialize).toHaveBeenCalledOnce()
    expect(mockB.initialize).toHaveBeenCalledOnce()
  })

  it('returns instance names', () => {
    const router = makeRouter()
    expect(router.instanceNames).toEqual(['app-a', 'app-b'])
  })

  // ---- Search: single instance ----

  it('search routes to a specific instance when instance is provided', async () => {
    const router = makeRouter()
    mockA.search.mockResolvedValue([sampleResult('/tmp/app-a/file.ts')])

    const results = await router.search([0.1, 0.2], { instance: 'app-a', limit: 5 })

    expect(mockA.search).toHaveBeenCalledWith([0.1, 0.2], { limit: 5 })
    expect(mockB.search).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
  })

  // ---- Search: cross-instance ----

  it('search with instance="*" queries all instances and merges results', async () => {
    const router = makeRouter()
    mockA.search.mockResolvedValue([sampleResult('/tmp/app-a/a.ts', 0.1)])
    mockB.search.mockResolvedValue([sampleResult('/tmp/app-b/b.ts', 0.2)])

    const results = await router.search([0.1, 0.2], { instance: '*', limit: 3 })

    expect(mockA.search).toHaveBeenCalled()
    expect(mockB.search).toHaveBeenCalled()
    expect(results).toHaveLength(2)
  })

  it('search without instance queries all instances', async () => {
    const router = makeRouter()
    mockA.search.mockResolvedValue([sampleResult('/tmp/app-a/a.ts')])
    mockB.search.mockResolvedValue([sampleResult('/tmp/app-b/b.ts')])

    const results = await router.search([0.1, 0.2], { limit: 3 })

    expect(mockA.search).toHaveBeenCalled()
    expect(mockB.search).toHaveBeenCalled()
    expect(results).toHaveLength(2)
  })

  // ---- Search: unknown instance ----

  it('search throws RouterError for unknown instance', async () => {
    const router = makeRouter()

    await expect(router.search([0.1, 0.2], { instance: 'nonexistent' })).rejects.toThrow(
      RouterError
    )

    await expect(router.search([0.1, 0.2], { instance: 'nonexistent' })).rejects.toThrow(
      'Unknown instance'
    )
  })

  // ---- Search: partial failure ----

  it('search tolerates a single instance failure', async () => {
    const router = makeRouter()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockA.search.mockRejectedValue(new Error('boom'))
    mockB.search.mockResolvedValue([sampleResult('/tmp/app-b/b.ts')])

    const results = await router.search([0.1, 0.2], { instance: '*', limit: 5 })

    expect(mockA.search).toHaveBeenCalled()
    expect(mockB.search).toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]?.filePath).toBe('/tmp/app-b/b.ts')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  // ---- Insert: routing ----

  it('insertChunks routes chunks to the correct instance by filePath', async () => {
    const router = makeRouter()

    const chunkA = makeChunk('/tmp/app-a/src/index.ts')
    const chunkB = makeChunk('/tmp/app-b/src/main.ts')

    await router.insertChunks([chunkA, chunkB])

    expect(mockA.insertChunks).toHaveBeenCalledWith([chunkA])
    expect(mockB.insertChunks).toHaveBeenCalledWith([chunkB])
  })

  // ---- Insert: unowned file ----

  it('insertChunks throws RouterError when a chunk path matches no instance', async () => {
    const router = makeRouter()

    await expect(router.insertChunks([makeChunk('/other/dir/file.ts')])).rejects.toThrow(
      RouterError
    )

    await expect(router.insertChunks([makeChunk('/other/dir/file.ts')])).rejects.toThrow(
      'No instance owns file paths'
    )
  })

  // ---- Delete ----

  it('deleteChunks routes by filePath to the owning instance', async () => {
    const router = makeRouter()
    mockA.deleteChunks.mockResolvedValue(3)

    const count = await router.deleteChunks('/tmp/app-a/src/file.ts')

    expect(mockA.deleteChunks).toHaveBeenCalledWith('/tmp/app-a/src/file.ts')
    expect(mockB.deleteChunks).not.toHaveBeenCalled()
    expect(count).toBe(3)
  })

  // ---- listFiles: aggregation ----

  it('listFiles aggregates results from all instances', async () => {
    const router = makeRouter()
    mockA.listFiles.mockResolvedValue([
      { filePath: '/tmp/app-a/a.ts', chunkCount: 2, timestamp: '2024-01-01' },
    ])
    mockB.listFiles.mockResolvedValue([
      { filePath: '/tmp/app-b/b.ts', chunkCount: 3, timestamp: '2024-01-02' },
    ])

    const files = await router.listFiles()

    expect(mockA.listFiles).toHaveBeenCalled()
    expect(mockB.listFiles).toHaveBeenCalled()
    expect(files).toHaveLength(2)
  })

  // ---- listFiles: single instance ----

  it('listFiles with instance queries only that instance', async () => {
    const router = makeRouter()
    mockA.listFiles.mockResolvedValue([
      { filePath: '/tmp/app-a/a.ts', chunkCount: 2, timestamp: '2024-01-01' },
    ])

    const files = await router.listFiles('app-a')

    expect(mockA.listFiles).toHaveBeenCalled()
    expect(mockB.listFiles).not.toHaveBeenCalled()
    expect(files).toHaveLength(1)
  })

  // ---- getStatus: aggregation ----

  it('getStatus aggregates and includes per-instance breakdown', async () => {
    const router = makeRouter()
    mockA.getStatus.mockResolvedValue({
      documentCount: 5,
      chunkCount: 20,
      memoryUsage: 10,
      uptime: 100,
      ftsIndexEnabled: true,
      searchMode: 'hybrid' as const,
    })
    mockB.getStatus.mockResolvedValue({
      documentCount: 3,
      chunkCount: 15,
      memoryUsage: 5,
      uptime: 100,
      ftsIndexEnabled: true,
      searchMode: 'hybrid' as const,
    })

    const status = await router.getStatus()

    expect(status.documentCount).toBe(8)
    expect(status.chunkCount).toBe(35)
    expect(status.instances).toHaveLength(2)
    expect(status.instances[0]?.name).toBe('app-a')
    expect(status.instances[0]?.documentCount).toBe(5)
    expect(status.instances[1]?.name).toBe('app-b')
    expect(status.instances[1]?.documentCount).toBe(3)
  })

  // ---- updateConfig: broadcast ----

  it('updateConfig broadcasts to all instances', () => {
    const router = makeRouter()
    router.updateConfig({ hybridWeight: 0.8 })

    expect(mockA.updateConfig).toHaveBeenCalledWith({ hybridWeight: 0.8 })
    expect(mockB.updateConfig).toHaveBeenCalledWith({ hybridWeight: 0.8 })
  })

  // ---- Longest prefix match ----

  it('routes files to the most-specific (longest prefix) instance', async () => {
    // The mock constructor alternates mockA / mockB.
    // makeRouter() consumed calls 0-1 (mockA=app-a, mockB=app-b).
    // Now create a second router with overlapping prefixes:
    //   call 2 → mockA = "shallow" (/home/)
    //   call 3 → mockB = "deep" (/home/a/)
    const router = new InstanceRouter([
      { name: 'shallow', baseDir: '/home/', dbPath: '/db1', rawBaseDir: '/home' },
      { name: 'deep', baseDir: '/home/a/', dbPath: '/db2', rawBaseDir: '/home/a' },
    ])

    const chunkInDeep = makeChunk('/home/a/x.ts')

    await router.insertChunks([chunkInDeep])

    // mockB is "deep" — it should receive the chunk because /home/a/ > /home/
    expect(mockB.insertChunks).toHaveBeenCalledWith([chunkInDeep])
    // mockA is "shallow" — it should NOT receive the chunk
    // Note: mockA.insertChunks may have been called by a previous test,
    // so don't assert "not called" here. Instead, check that mockB was
    // called with the right argument.
    expect(mockA.insertChunks).not.toHaveBeenCalledWith([chunkInDeep])
  })

  // ---- findTextReferences ----

  it('findTextReferences aggregates results across all instances', async () => {
    const router = makeRouter()
    mockA.findTextReferences.mockResolvedValue([
      { filePath: '/tmp/app-a/a.ts', chunkIndex: 1, context: 'hello' },
    ])
    mockB.findTextReferences.mockResolvedValue([
      { filePath: '/tmp/app-b/b.ts', chunkIndex: 2, context: 'world' },
    ])

    const results = await router.findTextReferences('test', 10)

    expect(mockA.findTextReferences).toHaveBeenCalled()
    expect(mockB.findTextReferences).toHaveBeenCalled()
    expect(results).toHaveLength(2)
  })

  it('findTextReferences respects the limit parameter', async () => {
    const router = makeRouter()
    mockA.findTextReferences.mockResolvedValue([
      { filePath: '/tmp/app-a/a.ts', chunkIndex: 1, context: 'a' },
      { filePath: '/tmp/app-a/b.ts', chunkIndex: 2, context: 'b' },
      { filePath: '/tmp/app-a/c.ts', chunkIndex: 3, context: 'c' },
    ])

    const results = await router.findTextReferences('test', 2)

    expect(results).toHaveLength(2)
  })

  // ---- getCodeChunksWithMeta ----

  it('getCodeChunksWithMeta aggregates across all instances', async () => {
    const router = makeRouter()
    const codeMeta = { imports: [], entities: [], scope: 'file' as const }
    mockA.getCodeChunksWithMeta.mockResolvedValue([
      { filePath: '/tmp/app-a/a.ts', chunkIndex: 0, codeMeta },
    ])
    mockB.getCodeChunksWithMeta.mockResolvedValue([
      { filePath: '/tmp/app-b/b.ts', chunkIndex: 1, codeMeta },
    ])

    const results = await router.getCodeChunksWithMeta()

    expect(mockA.getCodeChunksWithMeta).toHaveBeenCalled()
    expect(mockB.getCodeChunksWithMeta).toHaveBeenCalled()
    expect(results).toHaveLength(2)
  })

  // ---- Optimize broadcast ----

  it('optimize broadcasts to all instances', async () => {
    const router = makeRouter()
    await router.optimize()

    expect(mockA.optimize).toHaveBeenCalled()
    expect(mockB.optimize).toHaveBeenCalled()
  })

  // ---- getChunksByFilePath / getChunksByRange ----

  it('getChunksByFilePath routes by filePath', async () => {
    const router = makeRouter()
    const vecChunk = {
      id: '1',
      filePath: '/tmp/app-a/f.ts',
      chunkIndex: 0,
      text: 'hello',
      vector: [0.1],
      metadata: { fileName: 'f.ts', fileSize: 100, fileType: 'ts' },
      fileTitle: null,
      timestamp: '2024-01-01',
    }
    mockA.getChunksByFilePath.mockResolvedValue([vecChunk])

    const chunks = await router.getChunksByFilePath('/tmp/app-a/f.ts')

    expect(mockA.getChunksByFilePath).toHaveBeenCalledWith('/tmp/app-a/f.ts')
    expect(mockB.getChunksByFilePath).not.toHaveBeenCalled()
    expect(chunks).toHaveLength(1)
  })

  it('getChunksByFilePath returns empty array for unowned path', async () => {
    const router = makeRouter()
    const chunks = await router.getChunksByFilePath('/other/file.ts')
    expect(chunks).toEqual([])
    expect(mockA.getChunksByFilePath).not.toHaveBeenCalled()
    expect(mockB.getChunksByFilePath).not.toHaveBeenCalled()
  })

  it('getChunksByRange routes by filePath', async () => {
    const router = makeRouter()
    mockA.getChunksByRange.mockResolvedValue([
      { filePath: '/tmp/app-a/f.ts', chunkIndex: 0, text: 'hello', fileTitle: null },
    ])

    const chunks = await router.getChunksByRange('/tmp/app-a/f.ts', 0, 5)

    expect(mockA.getChunksByRange).toHaveBeenCalledWith('/tmp/app-a/f.ts', 0, 5)
    expect(chunks).toHaveLength(1)
  })

  it('getChunksByRange returns empty array for unowned path', async () => {
    const router = makeRouter()
    const chunks = await router.getChunksByRange('/other/file.ts', 0, 5)
    expect(chunks).toEqual([])
  })

  // ---- Close ----

  it('close closes all stores and swallows individual failures', async () => {
    const router = makeRouter()
    mockA.close.mockRejectedValue(new Error('close failed'))
    mockB.close.mockResolvedValue(undefined)

    await router.close()

    expect(mockA.close).toHaveBeenCalled()
    expect(mockB.close).toHaveBeenCalled()
  })
})
