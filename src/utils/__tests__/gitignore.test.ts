// Unit tests for utils/gitignore.ts

import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let noopFilter: typeof import('../../utils/gitignore.js').noopFilter
let loadGitignore: typeof import('../../utils/gitignore.js').loadGitignore

// Mock readFile from node:fs/promises
const mockReadFile = vi.fn<(_path: string, _enc: string) => Promise<string>>()

beforeAll(async () => {
  vi.doMock('node:fs/promises', () => ({
    readFile: mockReadFile,
  }))
  ;({ noopFilter, loadGitignore } = await import('../../utils/gitignore.js'))
})

afterAll(() => {
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
})

beforeEach(() => {
  mockReadFile.mockReset()
})

// ============================================
// noopFilter
// ============================================

describe('noopFilter', () => {
  it('never ignores any path', () => {
    const filter = noopFilter()
    expect(filter.ignores('/any/path/file.txt', false)).toBe(false)
    expect(filter.ignores('/any/path/dir', true)).toBe(false)
    expect(filter.ignores('/tmp/secret.env', false)).toBe(false)
  })
})

// ============================================
// loadGitignore
// ============================================

describe('loadGitignore', () => {
  it('returns noopFilter when no .gitignore found', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    const filter = await loadGitignore('/project')
    expect(filter.ignores('/project/src/file.ts', false)).toBe(false)
    expect(filter.ignores('/project/node_modules', true)).toBe(false)
  })

  it('ignores files matching .gitignore patterns', async () => {
    const rootDir = '/project'
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join(rootDir, '.gitignore')) return 'node_modules/\n*.log'
      throw new Error('ENOENT')
    })
    const filter = await loadGitignore(rootDir)

    expect(filter.ignores('/project/node_modules/foo', true)).toBe(true)
    expect(filter.ignores('/project/node_modules', true)).toBe(true)
    expect(filter.ignores('/project/error.log', false)).toBe(true)
    expect(filter.ignores('/project/src/index.ts', false)).toBe(false)
  })

  it('respects stopAbove boundary — does not walk past it', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join('/repo', '.gitignore')) return 'dist/\n'
      if (path === join('/repo', 'sub', '.gitignore')) return 'local-ignore.txt\n'
      throw new Error('ENOENT')
    })

    // Walk starts at /repo/sub, stops after /repo/sub itself (stopAbove = /repo)
    // So /repo/.gitignore is NOT checked
    const filter = await loadGitignore('/repo/sub', '/repo')

    // local-ignore.txt from /repo/sub/.gitignore should be ignored
    expect(filter.ignores('/repo/sub/local-ignore.txt', false)).toBe(true)
    // dist/ from /repo/.gitignore SHOULD apply (stopAbove includes /repo itself)
    expect(filter.ignores('/repo/sub/dist/foo.js', false)).toBe(true)
  })

  it('merges patterns from parent .gitignore files', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join('/repo', '.gitignore')) return '*.log\n'
      if (path === join('/repo', 'sub', '.gitignore')) return 'tmp/\n'
      throw new Error('ENOENT')
    })

    const filter = await loadGitignore('/repo/sub')

    // Both patterns should apply
    expect(filter.ignores('/repo/sub/error.log', false)).toBe(true)
    expect(filter.ignores('/repo/sub/tmp/data', true)).toBe(true)
    expect(filter.ignores('/repo/sub/src/index.ts', false)).toBe(false)
  })

  it('handles directory paths with trailing slash pattern', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join('/project', '.gitignore')) return 'build/\n'
      throw new Error('ENOENT')
    })
    const filter = await loadGitignore('/project')

    expect(filter.ignores('/project/build', true)).toBe(true)
    expect(filter.ignores('/project/build/output.js', false)).toBe(true)
    expect(filter.ignores('/project/build-tools', true)).toBe(false)
  })

  it('handles negated .gitignore patterns (! prefix)', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join('/project', '.gitignore')) return '*.log\n!important.log'
      throw new Error('ENOENT')
    })
    const filter = await loadGitignore('/project')

    // important.log should NOT be ignored (negated)
    expect(filter.ignores('/project/important.log', false)).toBe(false)
    // other.log should be ignored
    expect(filter.ignores('/project/other.log', false)).toBe(true)
  })

  it('stops upward walk at filesystem root when no stopAbove', async () => {
    // Mock only one .gitignore at /repo
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join('/repo', '.gitignore')) return 'secret.txt\n'
      throw new Error('ENOENT')
    })
    const filter = await loadGitignore('/repo/sub/deep')

    expect(filter.ignores('/repo/sub/deep/secret.txt', false)).toBe(true)
  })

  it('ignores patterns are relative to their gitignore base', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join('/repo', '.gitignore')) return '/src/temp/\n'
      if (path === join('/repo', 'sub', '.gitignore')) return 'temp/\n'
      throw new Error('ENOENT')
    })
    const filter = await loadGitignore('/repo/sub')

    // /repo/.gitignore pattern "/src/temp/" (root-relative) matches /repo/src/temp/ only
    // sub/.gitignore pattern "temp/" matches any temp/ directory under sub/
    expect(filter.ignores('/repo/sub/temp/cache', true)).toBe(true) // from sub/.gitignore
    expect(filter.ignores('/repo/src/temp/cache', true)).toBe(true) // from repo/.gitignore
    // /other/temp/ is not under /repo at all
    expect(filter.ignores('/other/temp/cache', true)).toBe(false)
  })

  it('handles empty .gitignore file gracefully', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join('/project', '.gitignore')) return ''
      throw new Error('ENOENT')
    })
    const filter = await loadGitignore('/project')
    expect(filter.ignores('/project/file.ts', false)).toBe(false)
  })

  it('handles .gitignore with comments and blank lines', async () => {
    mockReadFile.mockImplementation(async (path: string) => {
      if (path === join('/project', '.gitignore'))
        return '# This is a comment\n\n*.log\n\n# Another comment\n.env\n'
      throw new Error('ENOENT')
    })
    const filter = await loadGitignore('/project')

    expect(filter.ignores('/project/error.log', false)).toBe(true)
    expect(filter.ignores('/project/.env', false)).toBe(true)
    expect(filter.ignores('/project/src/main.ts', false)).toBe(false)
  })
})
