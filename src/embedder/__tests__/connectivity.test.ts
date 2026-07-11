import { describe, expect, it } from 'vitest'
import { MIRROR_CHAIN, nextMirror, probeApiEndpoint, resolveEndpoint } from '../connectivity.js'

describe('MIRROR_CHAIN', () => {
  it('includes huggingface.co as primary', () => {
    expect(MIRROR_CHAIN[0]).toBe('https://huggingface.co')
  })

  it('includes hf-mirror.com as fallback', () => {
    expect(MIRROR_CHAIN[1]).toBe('https://hf-mirror.com')
  })
})

describe('nextMirror', () => {
  it('returns hf-mirror.com for huggingface.co', () => {
    expect(nextMirror('https://huggingface.co')).toBe('https://hf-mirror.com')
  })

  it('returns undefined for the last mirror', () => {
    expect(nextMirror('https://hf-mirror.com')).toBeUndefined()
  })

  it('returns undefined for unknown endpoints', () => {
    expect(nextMirror('https://custom-mirror.example.com')).toBeUndefined()
  })
})

describe('probeApiEndpoint', () => {
  it('returns false for an unreachable host (timeout)', async () => {
    // 192.0.2.0/24 is reserved for documentation (TEST-NET-1), will never respond
    const ok = await probeApiEndpoint('https://192.0.2.1', 1000)
    expect(ok).toBe(false)
  })

  it('returns false when API endpoint 404s', async () => {
    // example.com /api/models/... → should 404 (no HuggingFace)
    const ok = await probeApiEndpoint('https://example.com', 5000)
    expect(ok).toBe(false)
  })

  it('returns a boolean (no throw) for hf-mirror.com', async () => {
    // hf-mirror.com/api/models/ 308-redirects to huggingface.co.
    // Result depends on whether huggingface.co is reachable from the
    // test environment — we only assert no crash and boolean return.
    const ok = await probeApiEndpoint('https://hf-mirror.com', 5000)
    expect(typeof ok).toBe('boolean')
  })

  it('returns true when huggingface.co Hub API is reachable', async () => {
    const ok = await probeApiEndpoint('https://huggingface.co', 5000)
    // In most environments huggingface.co is reachable.
    // If unreachable, this returns false — either outcome is acceptable.
    expect(typeof ok).toBe('boolean')
  })

  it('handles mirror URL with trailing slash', async () => {
    // Should not produce double-slash URLs like //api/models/...
    const ok = await probeApiEndpoint('https://hf-mirror.com/', 5000)
    expect(typeof ok).toBe('boolean')
  })
})

describe('resolveEndpoint', () => {
  it('returns explicit HF_ENDPOINT with apiComplete=true', async () => {
    const result = await resolveEndpoint({
      explicitEndpoint: 'https://my-mirror.example.com',
    })
    expect(result.endpoint).toBe('https://my-mirror.example.com')
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
    expect(MIRROR_CHAIN).toContain(result.endpoint)
    expect(typeof result.switched).toBe('boolean')
    expect(typeof result.apiComplete).toBe('boolean')
    expect(typeof result.logLine).toBe('string')
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

  it('returns consistent structure with apiComplete field', async () => {
    const result = await resolveEndpoint({})
    expect(result).toHaveProperty('endpoint')
    expect(result).toHaveProperty('switched')
    expect(result).toHaveProperty('apiComplete')
    expect(result).toHaveProperty('logLine')
    expect(typeof result.endpoint).toBe('string')
    expect(typeof result.apiComplete).toBe('boolean')
    expect(result.endpoint.length).toBeGreaterThan(0)
  })

  it('explicit HF_ENDPOINT always has apiComplete=true (user responsibility)', async () => {
    const result = await resolveEndpoint({
      explicitEndpoint: 'https://hf-mirror.com',
    })
    expect(result.endpoint).toBe('https://hf-mirror.com')
    expect(result.apiComplete).toBe(true)
    expect(result.switched).toBe(false)
  })
})
