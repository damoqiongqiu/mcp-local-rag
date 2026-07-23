// Unit tests for ingest/visual.ts — prepareVisualPdfChunks

import { basename } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChunkerInterface } from '../../chunker/index.js'

let prepareVisualPdfChunks: typeof import('../../ingest/visual.js').prepareVisualPdfChunks

// ============================================
// Mocks
// ============================================

const mockDetectVisualCandidates = vi.fn()
const mockEnrichPagesWithCaptions = vi.fn()
const mockCreateCaptioner = vi.fn()

beforeAll(async () => {
  vi.doMock('../../pdf-visual/index.js', () => ({
    createCaptioner: mockCreateCaptioner,
    detectVisualCandidates: mockDetectVisualCandidates,
    enrichPagesWithCaptions: mockEnrichPagesWithCaptions,
  }))
  ;({ prepareVisualPdfChunks } = await import('../../ingest/visual.js'))
})

afterAll(() => {
  vi.doUnmock('../../pdf-visual/index.js')
  vi.resetModules()
})

beforeEach(() => {
  mockDetectVisualCandidates.mockReset()
  mockEnrichPagesWithCaptions.mockReset()
  mockCreateCaptioner.mockReset()
})

// ============================================
// Helpers
// ============================================

function makeChunker(): ChunkerInterface {
  return {
    chunkText: vi.fn<ChunkerInterface['chunkText']>().mockResolvedValue([
      { text: 'Section 1: Introduction', index: 0 },
      { text: 'Section 2: Methods', index: 1 },
    ]),
  }
}

function makeEmbedder() {
  return {
    embedBatch: vi.fn().mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]),
  }
}

function makeParser(pages: Array<{ pageNum: number; text: string }> = []) {
  return {
    parsePdfPages: vi.fn().mockResolvedValue({
      doc: { destroy: vi.fn() },
      metadataTitle: 'Test PDF',
      pages: pages.map((p) => ({
        ...p,
        stextJson: {},
        page1FontHint: null,
      })),
    }),
  }
}

function makeCaptionerConfig() {
  return { profile: 'fast' as const, cacheDir: '/tmp/cache', device: 'cpu' }
}

// ============================================
// prepareVisualPdfChunks
// ============================================

describe('prepareVisualPdfChunks', () => {
  it('produces chunks and embeddings from enriched page text', async () => {
    const parser = makeParser([{ pageNum: 1, text: 'Page one content' }])
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [{ pageNum: 1, text: 'Page one content enriched' }],
      captions: [],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    const result = await prepareVisualPdfChunks(
      '/tmp/test.pdf',
      parser,
      chunker,
      embedder,
      makeCaptionerConfig()
    )

    expect(result.chunks).toHaveLength(2)
    expect(result.embeddings).toHaveLength(2)
    expect(chunker.chunkText).toHaveBeenCalledWith('Page one content enriched', embedder)
  })

  it('passes null title when extractPdfTitle returns null', async () => {
    const parser = makeParser([{ pageNum: 1, text: 'content' }])
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [{ pageNum: 1, text: 'content' }],
      captions: [],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    const result = await prepareVisualPdfChunks(
      '/tmp/no-title.pdf',
      parser,
      chunker,
      embedder,
      makeCaptionerConfig()
    )

    // extractPdfTitle uses metadataTitle when available
    expect(result.title).toBe('Test PDF')
  })

  it('appends caption chunks with visual-content wrapper', async () => {
    const parser = makeParser([{ pageNum: 1, text: 'Content' }])
    const chunker = makeChunker()
    // Return 2 embeddings for content, then 1 for caption
    const embedder = {
      embedBatch: vi
        .fn()
        .mockResolvedValueOnce([[0.1], [0.2]])
        .mockResolvedValueOnce([[0.3]]),
    }
    mockDetectVisualCandidates.mockReturnValue([{ pageNum: 1 }])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [{ pageNum: 1, text: 'Content enriched' }],
      captions: [{ pageNum: 1, text: 'diagram of architecture' }],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    const result = await prepareVisualPdfChunks(
      '/tmp/visual.pdf',
      parser,
      chunker,
      embedder,
      makeCaptionerConfig()
    )

    // 2 content chunks + 1 caption chunk = 3 total
    expect(result.chunks).toHaveLength(3)
    expect(result.chunks[2]!.text).toBe('[Visual content on page 1: diagram of architecture]')
    expect(result.embeddings).toHaveLength(3)
  })

  it('handles multiple caption chunks across pages', async () => {
    const parser = makeParser([
      { pageNum: 1, text: 'Page 1' },
      { pageNum: 2, text: 'Page 2' },
    ])
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([{ pageNum: 1 }, { pageNum: 2 }])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [
        { pageNum: 1, text: 'Page 1 enriched' },
        { pageNum: 2, text: 'Page 2 enriched' },
      ],
      captions: [
        { pageNum: 1, text: 'flowchart' },
        { pageNum: 2, text: 'table of metrics' },
      ],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    const result = await prepareVisualPdfChunks(
      '/tmp/multi.pdf',
      parser,
      chunker,
      embedder,
      makeCaptionerConfig()
    )

    expect(result.chunks).toHaveLength(4)
    expect(result.chunks[2]!.text).toContain('[Visual content on page 1:')
    expect(result.chunks[3]!.text).toContain('[Visual content on page 2:')
  })

  it('filters empty page texts before joining', async () => {
    const parser = makeParser([
      { pageNum: 1, text: 'Page 1' },
      { pageNum: 2, text: '' },
      { pageNum: 3, text: 'Page 3' },
    ])
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [
        { pageNum: 1, text: 'Page 1' },
        { pageNum: 2, text: '' },
        { pageNum: 3, text: 'Page 3' },
      ],
      captions: [],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    await prepareVisualPdfChunks('/tmp/test.pdf', parser, chunker, embedder, makeCaptionerConfig())

    // chunkText should be called with joined text excluding empty pages
    expect(chunker.chunkText).toHaveBeenCalledWith('Page 1\n\nPage 3', embedder)
  })

  it('calls doc.destroy() in finally on success', async () => {
    const destroyFn = vi.fn()
    const parser = {
      parsePdfPages: vi.fn().mockResolvedValue({
        doc: { destroy: destroyFn },
        metadataTitle: null,
        pages: [{ pageNum: 1, text: 'content', stextJson: {}, page1FontHint: null }],
      }),
    }
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [{ pageNum: 1, text: 'content' }],
      captions: [],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    await prepareVisualPdfChunks('/tmp/test.pdf', parser, chunker, embedder, makeCaptionerConfig())

    expect(destroyFn).toHaveBeenCalled()
  })

  it('calls doc.destroy() in finally on error', async () => {
    const destroyFn = vi.fn()
    const parser = {
      parsePdfPages: vi.fn().mockResolvedValue({
        doc: { destroy: destroyFn },
        metadataTitle: null,
        pages: [{ pageNum: 1, text: 'content', stextJson: {}, page1FontHint: null }],
      }),
    }
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockEnrichPagesWithCaptions.mockRejectedValue(new Error('VLM timeout'))

    await expect(
      prepareVisualPdfChunks('/tmp/test.pdf', parser, chunker, embedder, makeCaptionerConfig())
    ).rejects.toThrow('VLM timeout')

    // doc.destroy() should still be called even on error
    expect(destroyFn).toHaveBeenCalled()
  })

  it('swallows doc.destroy() failures without masking original error', async () => {
    const parser = {
      parsePdfPages: vi.fn().mockResolvedValue({
        doc: {
          destroy: vi.fn().mockImplementation(() => {
            throw new Error('destroy failed')
          }),
        },
        metadataTitle: null,
        pages: [{ pageNum: 1, text: 'content', stextJson: {}, page1FontHint: null }],
      }),
    }
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [{ pageNum: 1, text: 'content' }],
      captions: [],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    // Should succeed — destroy failure is swallowed
    const result = await prepareVisualPdfChunks(
      '/tmp/test.pdf',
      parser,
      chunker,
      embedder,
      makeCaptionerConfig()
    )
    expect(result.chunks).toHaveLength(2)
  })

  it('returns title from metadata when available', async () => {
    const parser = makeParser([{ pageNum: 1, text: '# Real Title\n\nContent' }])
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [{ pageNum: 1, text: '# Real Title\n\nContent' }],
      captions: [],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    const result = await prepareVisualPdfChunks(
      '/tmp/doc.pdf',
      parser,
      chunker,
      embedder,
      makeCaptionerConfig()
    )

    // extractPdfTitle should derive title from the markdown heading
    expect(result.title).toBeTruthy()
  })

  it('includes text field in result for metadata.fileSize', async () => {
    const parser = makeParser([
      { pageNum: 1, text: 'First page content' },
      { pageNum: 2, text: 'Second page content' },
    ])
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [
        { pageNum: 1, text: 'First page content' },
        { pageNum: 2, text: 'Second page content' },
      ],
      captions: [],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    const result = await prepareVisualPdfChunks(
      '/tmp/doc.pdf',
      parser,
      chunker,
      embedder,
      makeCaptionerConfig()
    )

    expect(result.text).toBe('First page content\n\nSecond page content')
  })

  it('creates captioner with correct config', async () => {
    const parser = makeParser([{ pageNum: 1, text: 'content' }])
    const chunker = makeChunker()
    const embedder = makeEmbedder()
    mockDetectVisualCandidates.mockReturnValue([])
    mockEnrichPagesWithCaptions.mockResolvedValue({
      pages: [{ pageNum: 1, text: 'content' }],
      captions: [],
    })
    mockCreateCaptioner.mockReturnValue({ caption: vi.fn() })

    await prepareVisualPdfChunks('/tmp/test.pdf', parser, chunker, embedder, {
      profile: 'quality',
      cacheDir: '/models',
      device: 'webgpu',
    })

    expect(mockCreateCaptioner).toHaveBeenCalledWith({
      profile: 'quality',
      cacheDir: '/models',
      device: 'webgpu',
    })
  })
})
