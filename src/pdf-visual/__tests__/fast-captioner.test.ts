// Unit tests for pdf-visual/captioners/fast.ts

import { beforeAll, describe, expect, it } from 'vitest'

let createFastCaptioner: (d: string) => Record<string, unknown>

beforeAll(async () => {
  const mod = await import('../captioners/fast.js')
  createFastCaptioner = mod.createFastCaptioner as typeof createFastCaptioner
})

describe('createFastCaptioner', () => {
  it('is a function', () => {
    expect(typeof createFastCaptioner).toBe('function')
  })

  it('returns object with caption method for cpu device', () => {
    const captioner = createFastCaptioner('cpu')
    expect(captioner).toHaveProperty('caption')
    expect(typeof (captioner as { caption: unknown }).caption).toBe('function')
  })

  it('returns object for webgpu device', () => {
    const captioner = createFastCaptioner('webgpu')
    expect(captioner).toHaveProperty('caption')
  })
})
