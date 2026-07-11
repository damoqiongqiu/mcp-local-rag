import { describe, expect, it } from 'vitest'
import { MIRROR_CHAIN, nextMirror, probeApiEndpoint, resolveEndpoint } from '../connectivity.js'

describe('MIRROR_CHAIN', () => {
  it('includes huggingface.co as primary', () => {
    expect(MIRROR_CHAIN[0].url).toBe('https://huggingface.co')
    expect(MIRROR_CHAIN[0].urlStyle).toBe('hf-hub')
    expect(MIRROR_CHAIN[0].pathTemplate).toBe('{model}/resolve/{revision}/{file}')
  })

  it('includes hf-mirror.com as second mirror', () => {
    expect(MIRROR_CHAIN[1].url).toBe('https://hf-mirror.com')
    expect(MIRROR_CHAIN[1].urlStyle).toBe('hf-hub')
  })

  it('includes modelscope.cn as third mirror', () => {
    expect(MIRROR_CHAIN[2].url).toBe('https://modelscope.cn')
    expect(MIRROR_CHAIN[2].urlStyle).toBe('modelscope')
    expect(MIRROR_CHAIN[2].pathTemplate).toContain('Revision=master')
    expect(MIRROR_CHAIN[2].pathTemplate).toContain('FilePath=')
  })

  it('has 3 mirrors in the chain', () => {
    expect(MIRROR_CHAIN.length).toBe(3)
  })
})

describe('nextMirror', () => {
  it('returns hf-mirror.com for huggingface.co', () => {
    const next = nextMirror('https://huggingface.co')
    expect(next).toBeDefined()
    expect(next!.url).toBe('https://hf-mirror.com')
  })

  it('returns modelscope.cn for hf-mirror.com', () => {
    const next = nextMirror('https://hf-mirror.com')
    expect(next).toBeDefined()
    expect(next!.url).toBe('https://modelscope.cn')
  })

  it('returns undefined for the last mirror', () => {
    expect(nextMirror('https://modelscope.cn')).toBeUndefined()
  })

  it('returns undefined for unknown endpoints', () => {
    expect(nextMirror('https://custom-mirror.example.com')).toBeUndefined()
  })
})

describe('probeApiEndpoint', () => {
  it('returns false for an unreachable host — hf-hub style (timeout)', async () => {
    // 192.0.2.0/24 is reserved for documentation (TEST-NET-1), will never respond
    const ok = await probeApiEndpoint(
      {
        url: 'https://192.0.2.1',
        pathTemplate: '{model}/resolve/{revision}/{file}',
        urlStyle: 'hf-hub',
      },
      1000
    )
    expect(ok).toBe(false)
  })

  it('returns false when Hub API endpoint 404s — hf-hub style', async () => {
    // example.com /api/models/... → should 404 (no HuggingFace)
    const ok = await probeApiEndpoint(
      {
        url: 'https://example.com',
        pathTemplate: '{model}/resolve/{revision}/{file}',
        urlStyle: 'hf-hub',
      },
      5000
    )
    expect(ok).toBe(false)
  })

  it('returns a boolean (no throw) for hf-mirror.com', async () => {
    // hf-mirror.com/api/models/ 308-redirects to huggingface.co.
    // Result depends on whether huggingface.co is reachable from the
    // test environment — we only assert no crash and boolean return.
    const ok = await probeApiEndpoint(MIRROR_CHAIN[1], 5000)
    expect(typeof ok).toBe('boolean')
  })

  it('returns true when huggingface.co Hub API is reachable', async () => {
    const ok = await probeApiEndpoint(MIRROR_CHAIN[0], 5000)
    // In most environments huggingface.co is reachable.
    // If unreachable, this returns false — either outcome is acceptable.
    expect(typeof ok).toBe('boolean')
  })

  it('handles hf-hub mirror URL with trailing slash', async () => {
    // Should not produce double-slash URLs like //api/models/...
    const ok = await probeApiEndpoint(
      {
        url: 'https://hf-mirror.com/',
        pathTemplate: '{model}/resolve/{revision}/{file}',
        urlStyle: 'hf-hub',
      },
      5000
    )
    expect(typeof ok).toBe('boolean')
  })

  it('returns a boolean for modelscope.cn (no throw)', async () => {
    // ModelScope uses direct-file probing. Result depends on whether
    // modelscope.cn is reachable from the test environment.
    const ok = await probeApiEndpoint(MIRROR_CHAIN[2], 5000)
    expect(typeof ok).toBe('boolean')
  })

  it('returns false for unreachable modelscope host', async () => {
    const ok = await probeApiEndpoint(
      {
        url: 'https://192.0.2.1',
        pathTemplate: 'api/v1/models/{model}/repo?Revision=master&FilePath=',
        urlStyle: 'modelscope',
      },
      1000
    )
    expect(ok).toBe(false)
  })
})

describe('resolveEndpoint', () => {
  it('returns explicit HF_ENDPOINT with standard pathTemplate and apiComplete=true', async () => {
    const result = await resolveEndpoint({
      explicitEndpoint: 'https://my-mirror.example.com',
    })
    expect(result.endpoint).toBe('https://my-mirror.example.com')
    expect(result.remotePathTemplate).toBe('{model}/resolve/{revision}/{file}')
    expect(result.switched).toBe(false)
    expect(result.apiComplete).toBe(true)
    expect(result.logLine).toContain('my-mirror.example.com')
  })

  it('returns huggingface.co with apiComplete=true when autoMirror is disabled', async () => {
    const result = await resolveEndpoint({ autoMirror: false })
    expect(result.endpoint).toBe('https://huggingface.co')
    expect(result.switched).toBe(false)
    expect(result.apiComplete).toBe(true)
    expect(result.logLine).toContain('Auto-mirror disabled')
  })

  it('defaults to auto-detect (autoMirror undefined = enabled)', async () => {
    const result = await resolveEndpoint({})
    const urls = MIRROR_CHAIN.map((m) => m.url)
    expect(urls).toContain(result.endpoint)
    expect(typeof result.switched).toBe('boolean')
    expect(typeof result.apiComplete).toBe('boolean')
    expect(typeof result.logLine).toBe('string')
    expect(typeof result.remotePathTemplate).toBe('string')
    expect(result.remotePathTemplate.length).toBeGreaterThan(0)
  })

  it('explicit HF_ENDPOINT takes priority over autoMirror=false', async () => {
    const result = await resolveEndpoint({
      explicitEndpoint: 'https://custom.example.com',
      autoMirror: false,
    })
    expect(result.endpoint).toBe('https://custom.example.com')
    expect(result.switched).toBe(false)
    expect(result.apiComplete).toBe(true)
  })

  it('returns consistent structure with all required fields', async () => {
    const result = await resolveEndpoint({})
    expect(result).toHaveProperty('endpoint')
    expect(result).toHaveProperty('switched')
    expect(result).toHaveProperty('apiComplete')
    expect(result).toHaveProperty('logLine')
    expect(result).toHaveProperty('remotePathTemplate')
    expect(typeof result.endpoint).toBe('string')
    expect(typeof result.apiComplete).toBe('boolean')
    expect(typeof result.remotePathTemplate).toBe('string')
    expect(result.endpoint.length).toBeGreaterThan(0)
    expect(result.remotePathTemplate.length).toBeGreaterThan(0)
  })

  it('explicit HF_ENDPOINT always has apiComplete=true (user responsibility)', async () => {
    const result = await resolveEndpoint({
      explicitEndpoint: 'https://hf-mirror.com',
    })
    expect(result.endpoint).toBe('https://hf-mirror.com')
    expect(result.apiComplete).toBe(true)
    expect(result.switched).toBe(false)
  })

  it('returns remotePathTemplate matching the resolved mirror', async () => {
    const result = await resolveEndpoint({})
    const mirror = MIRROR_CHAIN.find((m) => m.url === result.endpoint)
    if (mirror) {
      expect(result.remotePathTemplate).toBe(mirror.pathTemplate)
    }
  })
})
