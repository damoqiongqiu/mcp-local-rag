// Unit tests for pdf-visual/captioners/shared.ts

import { describe, expect, it, vi } from 'vitest'
import { buildModelLoadOptions, createModelLoader, postProcess } from '../captioners/shared.js'

// ============================================
// buildModelLoadOptions
// ============================================

describe('buildModelLoadOptions', () => {
  it('returns dtype=q4 options with the given device', () => {
    const result = buildModelLoadOptions('webgpu')
    expect(result.dtypeOpt.dtype).toBe('q4')
    expect(result.modelOpt.dtype).toBe('q4')
    expect(result.modelOpt.device).toBe('webgpu')
  })

  it('passes through cpu device', () => {
    const result = buildModelLoadOptions('cpu')
    expect(result.modelOpt.device).toBe('cpu')
  })

  it('passes through wasm device', () => {
    const result = buildModelLoadOptions('wasm')
    expect(result.modelOpt.device).toBe('wasm')
  })
})

// ============================================
// createModelLoader
// ============================================

describe('createModelLoader', () => {
  it('calls load callback once and caches result', async () => {
    const load = vi.fn().mockResolvedValue({ processor: {}, model: {} })
    const loader = createModelLoader('test-model', 'cpu', load)

    const r1 = await loader.ensureLoaded()
    const r2 = await loader.ensureLoaded()

    expect(r1).toEqual({ processor: {}, model: {} })
    expect(r2).toBe(r1) // same object, cached
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('re-throws cached error on subsequent calls after failure', async () => {
    const load = vi.fn().mockRejectedValue(new Error('download failed'))
    const loader = createModelLoader('bad-model', 'cpu', load)

    await expect(loader.ensureLoaded()).rejects.toThrow(
      'Captioner load failed (modelName=bad-model, device=cpu)'
    )

    // Second call should throw the same cached error without calling load again
    await expect(loader.ensureLoaded()).rejects.toThrow(
      'Captioner load failed (modelName=bad-model, device=cpu)'
    )
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('wraps non-Error throwables in Error', async () => {
    const load = vi.fn().mockRejectedValue('string error')
    const loader = createModelLoader('model', 'cpu', load)

    await expect(loader.ensureLoaded()).rejects.toThrow(
      'Captioner load failed (modelName=model, device=cpu): string error'
    )
  })

  it('includes modelName and device in error message', async () => {
    const load = vi.fn().mockRejectedValue(new Error('OOM'))
    const loader = createModelLoader('Qwen2.5-VL-3B', 'webgpu', load)

    await expect(loader.ensureLoaded()).rejects.toThrow(
      'Captioner load failed (modelName=Qwen2.5-VL-3B, device=webgpu): OOM'
    )
  })

  it('preserves original error as cause', async () => {
    const load = vi.fn().mockRejectedValue(new Error('network timeout'))
    const loader = createModelLoader('model', 'cpu', load)

    try {
      await loader.ensureLoaded()
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).cause).toBeInstanceOf(Error)
      expect(((err as Error).cause as Error).message).toBe('network timeout')
    }
  })

  it('passes correct options to load callback', async () => {
    const load = vi.fn().mockResolvedValue({ processor: {}, model: {} })
    const loader = createModelLoader('model', 'webgpu', load)

    await loader.ensureLoaded()

    expect(load).toHaveBeenCalledWith({
      dtypeOpt: { dtype: 'q4' },
      modelOpt: { dtype: 'q4', device: 'webgpu' },
    })
  })
})

// ============================================
// postProcess
// ============================================

describe('postProcess', () => {
  it('returns trimmed string for normal input', () => {
    expect(postProcess('  hello world  ')).toBe('hello world')
  })

  it('returns null for empty string after trim', () => {
    expect(postProcess('')).toBeNull()
    expect(postProcess('   ')).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(postProcess(' \t\n ')).toBeNull()
  })

  it('strips C0 control characters (except tab and newline)', () => {
    // U+0000 (NUL), U+0001 (SOH), U+001F (US) are stripped
    const input = 'he\x00l\x01lo\x1f world'
    expect(postProcess(input)).toBe('hello world')
  })

  it('strips C1 control characters (U+007F–U+009F)', () => {
    // DEL (U+007F) and APC (U+009F) are stripped
    const input = 'hello\x7f\x9f world'
    expect(postProcess(input)).toBe('hello world')
  })

  it('preserves tab (\\t) and newline (\\n)', () => {
    const input = 'line1\n\tindented'
    expect(postProcess(input)).toBe('line1\n\tindented')
  })

  it('truncates strings longer than MAX_CAPTION_LENGTH with ellipsis', () => {
    const long = 'x'.repeat(1100)
    const result = postProcess(long)
    expect(result).toBe('x'.repeat(1000) + '…')
    expect(result!.length).toBe(1001) // 1000 chars + …
  })

  it('does not truncate strings exactly at MAX_CAPTION_LENGTH', () => {
    const exact = 'x'.repeat(1000)
    expect(postProcess(exact)).toBe(exact)
  })

  it('handles mixed content with control chars and length', () => {
    const input = '\x00' + 'x'.repeat(1100) + '\x1f'
    const result = postProcess(input)
    expect(result).toBe('x'.repeat(1000) + '…')
  })

  it('strips then trims — correct ordering', () => {
    const input = '  \x00hello\x01  '
    expect(postProcess(input)).toBe('hello')
  })

  it('returns null when all chars are stripped control chars', () => {
    expect(postProcess('\x00\x01\x1f\x7f')).toBeNull()
  })
})
