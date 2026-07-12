// Embedder unit tests
// Test Type: Integration Test (uses the real @huggingface/transformers pipeline)
// Covers the wrapped-error paths and empty-input short-circuits that the
// maintainer flagged as untested.
//
// connectivity.js is mocked so the mirror-retry path in initialize() does not
// swallow the transformers.js native device-validation error before it surfaces.
// The mock returns huggingface.co as reachable; the real pipeline still loads
// and runs models normally through the cached local model directory.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getTestDevice, testModelCacheDir } from '../test-device.js'

const mocks = vi.hoisted(() => ({
  mockResolveEndpoint: vi.fn(),
  mockNextMirror: vi.fn(),
}))

const DEFAULT_ENDPOINT = 'https://huggingface.co'
const DEFAULT_PATH_TEMPLATE = '{model}/resolve/{revision}/'

const connectivityFactory = () => ({
  resolveEndpoint: mocks.mockResolveEndpoint,
  nextMirror: mocks.mockNextMirror,
})

let Embedder: typeof import('../../embedder/index.js').Embedder
let EmbeddingError: typeof import('../../embedder/index.js').EmbeddingError

// embed()/embedBatch() resolve to numeric vectors; the `.catch` handlers below
// capture the rejection, so the awaited value is typed `Error | <vector>`.
// Narrow to `Error` before asserting on `.message` (the rejection is what these
// tests exercise — a resolved vector here is itself a test failure).
function asError(value: unknown): Error {
  if (!(value instanceof Error)) {
    throw new Error(`expected a thrown Error, but the call resolved with: ${String(value)}`)
  }
  return value
}

function makeEmbedder(device?: string): InstanceType<typeof Embedder> {
  return new Embedder({
    modelPath: 'Xenova/all-MiniLM-L6-v2',
    batchSize: 16,
    cacheDir: testModelCacheDir(),
    device: device ?? getTestDevice(),
  })
}

describe('Embedder', () => {
  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('../../embedder/connectivity.js', connectivityFactory)
    ;({ Embedder, EmbeddingError } = await import('../../embedder/index.js'))

    // Default connectivity: huggingface.co is reachable, no mirror fallback.
    mocks.mockResolveEndpoint.mockResolvedValue({
      endpoint: DEFAULT_ENDPOINT,
      remotePathTemplate: DEFAULT_PATH_TEMPLATE,
      switched: false,
      apiComplete: true,
      logLine: `${DEFAULT_ENDPOINT} is reachable, using as primary`,
    })
    mocks.mockNextMirror.mockReturnValue(undefined)
  })

  afterAll(() => {
    vi.doUnmock('../../embedder/connectivity.js')
    vi.resetModules()
  })

  describe('embed() input validation', () => {
    it('rejects empty string before initializing the model', async () => {
      // Use a deliberately broken device so init *would* fail if it were attempted.
      // The empty-text guard must short-circuit before we get there.
      const embedder = makeEmbedder('definitely-not-a-real-device')

      const err = asError(await embedder.embed('').catch((e) => e))
      expect(err).toBeInstanceOf(EmbeddingError)
      expect(err.message).toBe('Cannot generate embedding for empty text')
    })
  })

  describe('embedBatch()', () => {
    it('returns [] for empty input without initializing the model', async () => {
      const embedder = makeEmbedder('definitely-not-a-real-device')

      // No init attempt → no device error surfaces.
      await expect(embedder.embedBatch([])).resolves.toEqual([])
    })

    it('early-rethrows EmbeddingError from embed() instead of re-wrapping with batch guidance', async () => {
      const embedder = makeEmbedder()

      const err = asError(await embedder.embedBatch(['valid', '']).catch((e) => e))
      expect(err).toBeInstanceOf(EmbeddingError)
      expect(err.message).toBe('Cannot generate embedding for empty text')
      expect(err.message).not.toMatch(/Failed to generate batch embeddings/)
    })

    it('produces per-text vectors equivalent to embed() (true batching)', async () => {
      const embedder = makeEmbedder()
      const texts = ['alpha text one', 'beta different two', 'gamma third sample']

      const batched = await embedder.embedBatch(texts)
      const single = await Promise.all(texts.map((t) => embedder.embed(t)))

      expect(batched).toHaveLength(texts.length)
      for (let i = 0; i < texts.length; i++) {
        expect(batched[i]).toHaveLength(single[i].length)
        for (let j = 0; j < batched[i].length; j++) {
          // Batched matmuls vs single-input differ only at float epsilon;
          // mean-pooling honors the attention mask so padding does not skew rows.
          expect(batched[i][j]).toBeCloseTo(single[i][j], 4)
        }
      }
    }, 180000)
  })

  describe('device validation', () => {
    it('surfaces transformers.js native error as EmbeddingError when pipeline init fails', async () => {
      const embedder = makeEmbedder('definitely-not-a-real-device')

      const err = asError(await embedder.embed('hello').catch((e) => e))
      expect(err).toBeInstanceOf(EmbeddingError)
      // Underlying message comes through verbatim; we don't add our own prefix.
      expect(err.message).toMatch(/Unsupported device/)
      expect(err.message).toMatch(/definitely-not-a-real-device/)
    })

    it('does not add speculative cache/network guidance to init failures', async () => {
      const embedder = makeEmbedder('definitely-not-a-real-device')

      const err = asError(await embedder.embed('hello').catch((e) => e))
      expect(err).toBeInstanceOf(EmbeddingError)
      expect(err.message).not.toMatch(/Network connectivity/)
      expect(err.message).not.toMatch(/Insufficient disk space/)
    })
  })

  describe('dispose()', () => {
    it('is safe to call before any embed() invocation', async () => {
      const embedder = makeEmbedder()
      await expect(embedder.dispose()).resolves.toBeUndefined()
    })
  })
})
