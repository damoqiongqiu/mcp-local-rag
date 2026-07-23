// Unit tests for ingest/compute.ts — the shared chunk+embed computation pipeline

import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ChunkerInterface, TextChunk } from '../../chunker/index.js'
import type { EmbedderInterface } from '../../chunker/semantic-chunker.js'
import { buildChunksAndEmbeddings, buildVectorChunks } from '../../ingest/compute.js'

// ============================================
// Helpers
// ============================================

function makeChunk(index: number, text: string, extra?: Partial<TextChunk>): TextChunk {
  return { index, text, ...extra }
}

function makeChunker(chunks: TextChunk[]): ChunkerInterface {
  return {
    chunkText: vi.fn<ChunkerInterface['chunkText']>().mockResolvedValue(chunks),
  }
}

function makeEmbedder(embeddings: number[][]): EmbedderInterface {
  return {
    embedBatch: vi.fn<EmbedderInterface['embedBatch']>().mockResolvedValue(embeddings),
  }
}

// ============================================
// buildChunksAndEmbeddings
// ============================================

describe('buildChunksAndEmbeddings', () => {
  it('returns chunks and matching embeddings for normal input', async () => {
    const chunker = makeChunker([makeChunk(0, 'hello'), makeChunk(1, 'world')])
    const embedder = makeEmbedder([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    const result = await buildChunksAndEmbeddings('hello world', 'Test Doc', chunker, embedder)

    expect(result.chunks).toHaveLength(2)
    expect(result.embeddings).toHaveLength(2)
    expect(result.embeddings[0]).toEqual([0.1, 0.2])
    expect(result.embeddings[1]).toEqual([0.3, 0.4])
    expect(result.title).toBe('Test Doc')
  })

  it('passes title through as null when null', async () => {
    const chunker = makeChunker([makeChunk(0, 'text')])
    const embedder = makeEmbedder([[0.5]])
    const result = await buildChunksAndEmbeddings('text', null, chunker, embedder)
    expect(result.title).toBeNull()
  })

  it('skips embedBatch when chunker returns zero chunks', async () => {
    const chunker = makeChunker([])
    const embedder = makeEmbedder([])
    const result = await buildChunksAndEmbeddings('', null, chunker, embedder)

    expect(result.chunks).toHaveLength(0)
    expect(result.embeddings).toHaveLength(0)
    // embedBatch should NOT have been called — prevents unnecessary model load
    expect(embedder.embedBatch).not.toHaveBeenCalled()
  })

  it('uses textForEmbedding when present on chunks', async () => {
    const chunker = makeChunker([makeChunk(0, 'plain text', { textForEmbedding: 'enriched text' })])
    const embedder = makeEmbedder([[0.7]])
    await buildChunksAndEmbeddings('text', 'Title', chunker, embedder)

    expect(embedder.embedBatch).toHaveBeenCalledWith(['enriched text'])
  })

  it('falls back to chunk.text when textForEmbedding is absent', async () => {
    const chunker = makeChunker([makeChunk(0, 'plain text')])
    const embedder = makeEmbedder([[0.7]])
    await buildChunksAndEmbeddings('text', 'Title', chunker, embedder)

    expect(embedder.embedBatch).toHaveBeenCalledWith(['plain text'])
  })

  it('propagates chunker errors verbatim', async () => {
    const chunker: ChunkerInterface = {
      chunkText: vi.fn().mockRejectedValue(new Error('chunk failure')),
    }
    const embedder = makeEmbedder([])
    await expect(buildChunksAndEmbeddings('text', null, chunker, embedder)).rejects.toThrow(
      'chunk failure'
    )
  })

  it('propagates embedder errors verbatim', async () => {
    const chunker = makeChunker([makeChunk(0, 'text')])
    const embedder: EmbedderInterface = {
      embedBatch: vi.fn().mockRejectedValue(new Error('embed failure')),
    }
    await expect(buildChunksAndEmbeddings('text', null, chunker, embedder)).rejects.toThrow(
      'embed failure'
    )
  })

  it('handles single large chunk correctly', async () => {
    const largeText = 'x'.repeat(10000)
    const chunker = makeChunker([makeChunk(0, largeText)])
    const embedder = makeEmbedder([Array(384).fill(0.1)])
    const result = await buildChunksAndEmbeddings(largeText, null, chunker, embedder)

    expect(result.chunks).toHaveLength(1)
    expect(result.embeddings[0]).toHaveLength(384)
  })

  it('handles empty string input that chunker still processes', async () => {
    const chunker = makeChunker([])
    const embedder = makeEmbedder([])
    const result = await buildChunksAndEmbeddings('', null, chunker, embedder)

    expect(result.chunks).toHaveLength(0)
    expect(result.embeddings).toHaveLength(0)
    expect(embedder.embedBatch).not.toHaveBeenCalled()
  })

  it('preserves chunk metadata (codeMeta) in output', async () => {
    const codeMeta = {
      imports: [{ name: 'useEffect', source: 'react' }],
      entities: [{ name: 'App', type: 'function' as const }],
      scope: 'file' as const,
    }
    const chunker = makeChunker([makeChunk(0, 'function App() {}', { codeMeta })])
    const embedder = makeEmbedder([[0.1]])
    const result = await buildChunksAndEmbeddings('function App() {}', null, chunker, embedder)

    expect(result.chunks[0]!.codeMeta).toEqual(codeMeta)
  })
})

// ============================================
// buildVectorChunks
// ============================================

describe('buildVectorChunks', () => {
  it('builds VectorChunk array from chunks and embeddings', () => {
    const chunks: TextChunk[] = [makeChunk(0, 'first'), makeChunk(1, 'second')]
    const embeddings = [[0.1], [0.2]]
    const result = buildVectorChunks({
      filePath: '/tmp/test.txt',
      chunks,
      embeddings,
      fileSize: 15,
      fileTitle: 'My Doc',
    })

    expect(result).toHaveLength(2)
    expect(result[0]!.filePath).toBe('/tmp/test.txt')
    expect(result[0]!.chunkIndex).toBe(0)
    expect(result[0]!.text).toBe('first')
    expect(result[0]!.vector).toEqual([0.1])
    expect(result[0]!.metadata.fileName).toBe('test.txt')
    expect(result[0]!.metadata.fileSize).toBe(15)
    expect(result[0]!.metadata.fileType).toBe('txt')
    expect(result[0]!.fileTitle).toBe('My Doc')
    expect(result[0]!.id).toBeDefined()
    expect(result[0]!.timestamp).toBeDefined()
  })

  it('derives fileName from filePath basename', () => {
    const result = buildVectorChunks({
      filePath: '/deeply/nested/path/document.pdf',
      chunks: [makeChunk(0, 'pdf content')],
      embeddings: [[0.1]],
      fileSize: 100,
      fileTitle: null,
    })
    expect(result[0]!.metadata.fileName).toBe('document.pdf')
    expect(result[0]!.metadata.fileType).toBe('pdf')
  })

  it('handles filePath with no extension', () => {
    const result = buildVectorChunks({
      filePath: '/tmp/Makefile',
      chunks: [makeChunk(0, 'all: build')],
      embeddings: [[0.1]],
      fileSize: 10,
      fileTitle: null,
    })
    expect(result[0]!.metadata.fileName).toBe('Makefile')
    expect(result[0]!.metadata.fileType).toBe('')
  })

  it('assigns sequential chunk indices from chunk.index', () => {
    const chunks = [makeChunk(0, 'a'), makeChunk(5, 'b'), makeChunk(10, 'c')]
    const result = buildVectorChunks({
      filePath: '/tmp/test.txt',
      chunks,
      embeddings: [[0.1], [0.2], [0.3]],
      fileSize: 3,
      fileTitle: null,
    })
    expect(result.map((c) => c.chunkIndex)).toEqual([0, 5, 10])
  })

  it('assigns unique UUID per chunk', () => {
    const chunks = [makeChunk(0, 'a'), makeChunk(1, 'b')]
    const result = buildVectorChunks({
      filePath: '/tmp/test.txt',
      chunks,
      embeddings: [[0.1], [0.2]],
      fileSize: 2,
      fileTitle: null,
    })
    expect(result[0]!.id).not.toBe(result[1]!.id)
  })

  it('all chunks share the same timestamp', () => {
    const chunks = [makeChunk(0, 'a'), makeChunk(1, 'b')]
    const result = buildVectorChunks({
      filePath: '/tmp/test.txt',
      chunks,
      embeddings: [[0.1], [0.2]],
      fileSize: 2,
      fileTitle: null,
    })
    expect(result[0]!.timestamp).toBe(result[1]!.timestamp)
  })

  it('throws when embeddings array is shorter than chunks', () => {
    const chunks = [makeChunk(0, 'a'), makeChunk(1, 'b'), makeChunk(2, 'c')]
    const embeddings = [[0.1], [0.2]] // one short
    expect(() =>
      buildVectorChunks({
        filePath: '/tmp/test.txt',
        chunks,
        embeddings,
        fileSize: 3,
        fileTitle: null,
      })
    ).toThrow('Missing embedding for chunk 2')
  })

  it('includes codeMeta in VectorChunk when present on TextChunk', () => {
    const codeMeta = {
      imports: [{ name: 'useState', source: 'react' }],
      entities: [{ name: 'Counter', type: 'function' as const }],
      scope: 'file' as const,
    }
    const chunks: TextChunk[] = [makeChunk(0, 'function Counter() {}', { codeMeta })]
    const result = buildVectorChunks({
      filePath: '/tmp/Counter.tsx',
      chunks,
      embeddings: [[0.1]],
      fileSize: 20,
      fileTitle: null,
    })
    expect(result[0]!.codeMeta).toEqual(codeMeta)
  })

  it('omits codeMeta from VectorChunk when not present on TextChunk', () => {
    const chunks: TextChunk[] = [makeChunk(0, 'plain text')]
    const result = buildVectorChunks({
      filePath: '/tmp/test.txt',
      chunks,
      embeddings: [[0.1]],
      fileSize: 5,
      fileTitle: null,
    })
    expect(result[0]!.codeMeta).toBeUndefined()
  })

  it('returns empty array for empty chunks', () => {
    const result = buildVectorChunks({
      filePath: '/tmp/empty.txt',
      chunks: [],
      embeddings: [],
      fileSize: 0,
      fileTitle: null,
    })
    expect(result).toHaveLength(0)
  })

  it('handles filePath with nested directories via path.join', () => {
    const path = join('tmp', 'deep', 'nested', 'document.ts')
    const result = buildVectorChunks({
      filePath: path,
      chunks: [makeChunk(0, 'code')],
      embeddings: [[0.1]],
      fileSize: 4,
      fileTitle: null,
    })
    expect(result[0]!.metadata.fileName).toBe('document.ts')
    expect(result[0]!.metadata.fileType).toBe('ts')
  })
})
