import { describe, expect, it, vi } from 'vitest'
import { handleDedupCheck } from '../../../server/handlers/manage.js'

const deps = {
  instanceRouter: {
    listFiles: vi.fn().mockResolvedValue([]),
    getChunksByFilePath: vi.fn().mockResolvedValue([]),
  } as any,
  dbPath: '/test/db',
  withWarnings: vi.fn((c: any[]) => c),
}

describe('handleDedupCheck', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws for threshold < 0.5', async () => {
    await expect(handleDedupCheck(deps, { threshold: 0.3 })).rejects.toThrow('between 0.5 and 1.0')
  })

  it('throws for threshold > 1.0', async () => {
    await expect(handleDedupCheck(deps, { threshold: 1.5 })).rejects.toThrow('between 0.5 and 1.0')
  })

  it('throws for non-number threshold', async () => {
    await expect(handleDedupCheck(deps, { threshold: 'high' as any })).rejects.toThrow(
      'between 0.5 and 1.0'
    )
  })

  it('accepts boundary thresholds (0.5, 1.0)', async () => {
    await handleDedupCheck(deps, { threshold: 0.5 })
    await handleDedupCheck(deps, { threshold: 1.0 })
    expect(deps.instanceRouter.listFiles).toHaveBeenCalledTimes(2)
  })

  it('uses default threshold 0.8', async () => {
    await handleDedupCheck(deps, {})
    expect(deps.instanceRouter.listFiles).toHaveBeenCalled()
  })

  it('returns empty when < 2 files indexed', async () => {
    deps.instanceRouter.listFiles.mockResolvedValue([{ filePath: '/a.js' }])
    const result = await handleDedupCheck(deps, {})
    const data = JSON.parse((result.content[0] as any).text)
    expect(data.pairCount).toBe(0)
  })
})
