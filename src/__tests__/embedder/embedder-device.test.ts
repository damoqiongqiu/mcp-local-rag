// Embedder device validation unit tests
// Test Type: Unit Test (mocks connectivity to bypass network checks; relies on
// locally-cached model for real transformers.js device validation)
//
// Under vitest `isolate:false`, this test file uses `vi.doMock` + dynamic import
// to mock `connectivity.js` without leaking to other test files. The real
// `@huggingface/transformers` pipeline is used so that transformers.js can
// validate the device name against its own registry.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { testModelCacheDir } from '../test-device.js'

const mocks = vi.hoisted(() => ({
  resolveEndpoint: vi.fn(),
  nextMirror: vi.fn(),
}))

const DEFAULT_ENDPOINT = 'https://huggingface.co'
const DEFAULT_PATH_TEMPLATE = '{model}/resolve/{revision}/'

const connectivityFactory = () => ({
  resolveEndpoint: mocks.resolveEndpoint,
  nextMirror: mocks.nextMirror,
})

let Embedder: typeof import('../../embedder/index.js').Embedder
let EmbeddingError: typeof import('../../embedder/index.js').EmbeddingError

const MODEL_PATH = 'Xenova/all-MiniLM-L6-v2'

function makeEmbedder(device: string) {
  return new Embedder({
    modelPath: MODEL_PATH,
    batchSize: 16,
    cacheDir: testModelCacheDir(),
    device,
  })
}

describe('Embedder device validation', () => {
  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('../../embedder/connectivity.js', connectivityFactory)
    ;({ Embedder, EmbeddingError } = await import('../../embedder/index.js'))
  })

  afterAll(() => {
    vi.doUnmock('../../embedder/connectivity.js')
    vi.resetModules()
  })

  beforeEach(() => {
    // Connectivity is mocked to always succeed — no real network needed
    mocks.resolveEndpoint.mockResolvedValue({
      endpoint: DEFAULT_ENDPOINT,
      remotePathTemplate: DEFAULT_PATH_TEMPLATE,
      switched: false,
      apiComplete: true,
      logLine: 'mocked resolveEndpoint',
    })
    mocks.nextMirror.mockReturnValue(undefined)
  })

  it('surfaces transformers.js native error as EmbeddingError when pipeline init fails', async () => {
    const embedder = makeEmbedder('definitely-not-a-real-device')

    const err = await embedder.embed('hello').catch((e) => e)
    expect(err).toBeInstanceOf(EmbeddingError)
    // Underlying message comes through verbatim; we don't add our own prefix.
    expect(err.message).toMatch(/Unsupported device/)
    expect((err as Error).message).toMatch(/definitely-not-a-real-device/)
  })

  it('does not add speculative cache/network guidance to init failures', async () => {
    const embedder = makeEmbedder('definitely-not-a-real-device')

    const err = await embedder.embed('hello').catch((e) => e)
    expect(err).toBeInstanceOf(EmbeddingError)
    expect(err.message).not.toMatch(/Network connectivity/)
    expect(err.message).not.toMatch(/Insufficient disk space/)
  })

  it('surfaces the underlying transformers.js message as an EmbeddingError on lazy-init failure', async () => {
    const embedder = new Embedder({
      modelPath: MODEL_PATH,
      batchSize: 8,
      cacheDir: testModelCacheDir(),
      device: 'definitely-not-a-real-device',
    })
    // No explicit initialize() — lazy init on first embed() call
    const err = await embedder.embed('test').catch((e) => e as Error)
    expect(err).toBeInstanceOf(EmbeddingError)
    expect((err as Error).message).toMatch(/definitely-not-a-real-device/)
  })
})
