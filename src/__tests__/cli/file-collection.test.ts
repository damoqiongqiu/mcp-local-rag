// Unit tests for cli/file-collection.ts

import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let collectFiles: typeof import('../../cli/file-collection.js').collectFiles

const mockStat = vi.fn()
const mockReaddir = vi.fn()
const mockRealpath = vi.fn()
const mockExit = vi.fn()
const mockBfsCollect = vi.fn()

beforeAll(async () => {
  vi.doMock('node:fs/promises', () => ({
    stat: mockStat,
    realpath: mockRealpath,
    readdir: mockReaddir,
  }))
  vi.doMock('../../utils/scan.js', () => ({
    bfsCollectSupportedFiles: mockBfsCollect,
    realpathForMatch: vi.fn(),
  }))
  vi.doMock('../../utils/gitignore.js', () => ({
    loadGitignore: vi.fn().mockResolvedValue({ ignores: () => false }),
    noopFilter: () => ({ ignores: () => false }),
  }))
  vi.stubGlobal('process', { ...process, exit: mockExit })
  ;({ collectFiles } = await import('../../cli/file-collection.js'))
})

afterAll(() => {
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('../../utils/scan.js')
  vi.doUnmock('../../utils/gitignore.js')
  vi.unstubAllGlobals()
  vi.resetModules()
})

beforeEach(() => {
  mockStat.mockReset()
  mockReaddir.mockReset()
  mockRealpath.mockReset()
  mockExit.mockReset()
  mockBfsCollect.mockReset()
})

// ============================================
// collectFiles
// ============================================

describe('collectFiles', () => {
  const baseDirs = ['/project/']

  it('returns [resolved] for a single file with supported extension', async () => {
    mockStat.mockResolvedValue({ isFile: () => true, isDirectory: () => false })

    const result = await collectFiles('/project/src/index.ts', baseDirs, [])

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(resolve('/project/src/index.ts'))
  })

  it('returns empty for a single file with unsupported extension', async () => {
    mockStat.mockResolvedValue({ isFile: () => true, isDirectory: () => false })

    const result = await collectFiles('/project/data.bin', baseDirs, [])

    expect(result).toEqual([])
  })

  it('returns empty for non-file, non-directory stat result', async () => {
    mockStat.mockResolvedValue({ isFile: () => false, isDirectory: () => false })

    const result = await collectFiles('/project/socket', baseDirs, [])

    expect(result).toEqual([])
  })

  it('delegates to bfsCollectSupportedFiles for directories inside baseDir', async () => {
    mockStat.mockResolvedValue({ isFile: () => false, isDirectory: () => true })
    mockRealpath.mockResolvedValue('/project/src')
    mockBfsCollect.mockResolvedValue({
      files: ['/project/src/a.ts', '/project/src/b.ts'],
      unreadableDirs: [],
      depthLimited: false,
    })

    const result = await collectFiles('/project/src', baseDirs, ['/project/exclude/'])

    expect(result).toEqual([resolve('/project/src/a.ts'), resolve('/project/src/b.ts')])
    expect(mockBfsCollect).toHaveBeenCalled()
  })

  it('deduplicates and sorts collected files', async () => {
    mockStat.mockResolvedValue({ isFile: () => false, isDirectory: () => true })
    mockRealpath.mockResolvedValue('/project/src')
    mockBfsCollect.mockResolvedValue({
      files: ['/project/src/c.ts', '/project/src/a.ts', '/project/src/a.ts'],
      unreadableDirs: [],
      depthLimited: false,
    })

    const result = await collectFiles('/project/src', baseDirs, [])

    expect(result).toEqual([resolve('/project/src/a.ts'), resolve('/project/src/c.ts')])
  })

  it('passes excludePaths to bfsCollect', async () => {
    mockStat.mockResolvedValue({ isFile: () => false, isDirectory: () => true })
    mockRealpath.mockResolvedValue('/project')
    mockBfsCollect.mockResolvedValue({ files: [], unreadableDirs: [], depthLimited: false })

    const excludePaths = ['/project/node_modules/', '/project/.git/']
    await collectFiles('/project', baseDirs, excludePaths)

    expect(mockBfsCollect).toHaveBeenCalledWith(
      expect.any(String),
      excludePaths,
      undefined,
      undefined,
      expect.anything()
    )
  })
})
