import { describe, expect, it, vi } from 'vitest'

const { mockRawUtils } = vi.hoisted(() => ({
  mockRawUtils: {
    generateRawDataPath: vi.fn((_dbPath: string, source: string) => `/data/raw/${source}.md`),
    isPathInRawDataDirLexical: vi.fn().mockReturnValue(false),
    checkRawDataArtifacts: vi.fn().mockResolvedValue({ rawDataExisted: false, metaExisted: false }),
    isEnoent: vi.fn().mockReturnValue(false),
    generateMetaJsonPath: vi.fn((p: string) => `${p}.meta.json`),
  },
}))

vi.mock('node:fs/promises', () => ({ unlink: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../../utils/raw-data-utils.js', () => mockRawUtils)

import { handleDeleteFile } from '../../../server/handlers/delete.js'

const deps = {
  instanceRouter: {
    deleteChunks: vi.fn().mockResolvedValue(3),
    optimize: vi.fn().mockResolvedValue(undefined),
  } as any,
  parser: { validateFilePath: vi.fn().mockResolvedValue(undefined) } as any,
  dbPath: '/test/db',
  withWarnings: vi.fn((c: any[]) => c),
  assertConfigOk: vi.fn(),
}

describe('handleDeleteFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(deps.instanceRouter.deleteChunks as any).mockResolvedValue(3)
    mockRawUtils.isPathInRawDataDirLexical.mockReturnValue(false)
  })

  it('throws when neither filePath nor source is provided', async () => {
    await expect(handleDeleteFile(deps, {} as any)).rejects.toThrow('Either filePath or source')
  })

  it('calls configOk + validatePath for filePath mode', async () => {
    const result = await handleDeleteFile(deps, { filePath: '/test/file.md' })
    expect(deps.assertConfigOk).toHaveBeenCalled()
    expect(deps.parser.validateFilePath).toHaveBeenCalledWith('/test/file.md')
    const data = JSON.parse((result.content[0] as any).text)
    expect(data.deleted).toBe(true)
    expect(data.removedChunks).toBe(3)
  })

  it('skips validation for source mode', async () => {
    const result = await handleDeleteFile(deps, { source: 'clipboard://test' })
    expect(deps.assertConfigOk).not.toHaveBeenCalled()
    expect(deps.parser.validateFilePath).not.toHaveBeenCalled()
    const data = JSON.parse((result.content[0] as any).text)
    expect(data.filePath).toBe('/data/raw/clipboard://test.md')
  })

  it('marks existed: true when chunks removed', async () => {
    ;(deps.instanceRouter.deleteChunks as any).mockResolvedValue(5)
    const result = await handleDeleteFile(deps, { filePath: '/test/file.md' })
    const data = JSON.parse((result.content[0] as any).text)
    expect(data.existed).toBe(true)
  })

  it('marks existed: false when nothing removed', async () => {
    ;(deps.instanceRouter.deleteChunks as any).mockResolvedValue(0)
    const result = await handleDeleteFile(deps, { filePath: '/test/file.md' })
    const data = JSON.parse((result.content[0] as any).text)
    expect(data.existed).toBe(false)
  })

  it('calls withWarnings', async () => {
    await handleDeleteFile(deps, { filePath: '/test/file.md' })
    expect(deps.withWarnings).toHaveBeenCalled()
  })
})
