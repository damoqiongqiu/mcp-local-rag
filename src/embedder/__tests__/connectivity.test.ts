import { describe, expect, it } from 'vitest'
import { MIRROR_CHAIN, nextMirror, resolveEndpoint } from '../connectivity.js'

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

describe('resolveEndpoint', () => {
  it('returns explicit HF_ENDPOINT when set', async () => {
    const result = await resolveEndpoint({
      explicitEndpoint: 'https://my-mirror.example.com',
    })
    expect(result.endpoint).toBe('https://my-mirror.example.com')
    expect(result.switched).toBe(false)
    expect(result.logLine).toContain('my-mirror.example.com')
  })

  it('returns huggingface.co when autoMirror is disabled', async () => {
    const result = await resolveEndpoint({ autoMirror: false })
    expect(result.endpoint).toBe('https://huggingface.co')
    expect(result.switched).toBe(false)
    expect(result.logLine).toContain('Auto-mirror disabled')
  })

  it('defaults to auto-detect (autoMirror undefined = enabled)', async () => {
    // This will probe huggingface.co. In test environments, it may or may
    // not be reachable — the result is not deterministic, but the function
    // must not throw and must return a valid endpoint.
    const result = await resolveEndpoint({})
    expect(MIRROR_CHAIN).toContain(result.endpoint)
    expect(typeof result.switched).toBe('boolean')
    expect(typeof result.logLine).toBe('string')
  })

  it('explicit HF_ENDPOINT takes priority over autoMirror=false', async () => {
    const result = await resolveEndpoint({
      explicitEndpoint: 'https://custom.example.com',
      autoMirror: false,
    })
    expect(result.endpoint).toBe('https://custom.example.com')
    expect(result.switched).toBe(false)
  })

  it('returns consistent structure for any reachability outcome', async () => {
    const result = await resolveEndpoint({})
    expect(result).toHaveProperty('endpoint')
    expect(result).toHaveProperty('switched')
    expect(result).toHaveProperty('logLine')
    expect(typeof result.endpoint).toBe('string')
    expect(result.endpoint.length).toBeGreaterThan(0)
  })
})
