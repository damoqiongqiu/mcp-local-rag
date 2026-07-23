// Unit tests for bin/install-skills.ts

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let run: typeof import('../../bin/install-skills.js').run

const mockExit = vi.fn()
const mockLog = vi.fn()
const mockError = vi.fn()
const mockExistsSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockCpSync = vi.fn()

beforeAll(async () => {
  vi.doMock('node:fs', () => ({
    cpSync: mockCpSync,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(),
  }))
  vi.stubGlobal('process', { ...process, exit: mockExit })
  vi.stubGlobal('console', { ...console, log: mockLog, error: mockError })
  ;({ run } = await import('../../bin/install-skills.js'))
})

afterAll(() => {
  vi.doUnmock('node:fs')
  vi.unstubAllGlobals()
  vi.resetModules()
})

beforeEach(() => {
  mockExit.mockReset()
  mockLog.mockReset()
  mockError.mockReset()
  mockExistsSync.mockReset()
  mockMkdirSync.mockReset()
  mockCpSync.mockReset()
})

describe('run', () => {
  it('prints help and exits 0 with no arguments', () => {
    run([])
    expect(mockExit).toHaveBeenCalledWith(0)
  })

  it('exits with help for --help flag', () => {
    run(['--help'])
    expect(mockExit).toHaveBeenCalledWith(0)
  })

  it('exits with help for -h flag', () => {
    run(['-h'])
    expect(mockExit).toHaveBeenCalledWith(0)
  })

  it('installs to claude-code-project by default', () => {
    mockExistsSync.mockReturnValue(true)
    run(['--claude-code'])
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Installation complete'))
    expect(mockCpSync).toHaveBeenCalled()
  })

  it('installs to claude-code-global with --global flag', () => {
    mockExistsSync.mockReturnValue(true)
    run(['--claude-code', '--global'])
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Installation complete'))
  })

  it('installs to codex-global by default', () => {
    mockExistsSync.mockReturnValue(true)
    run(['--codex'])
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Installation complete'))
  })

  it('installs to codex-project with --project flag', () => {
    mockExistsSync.mockReturnValue(true)
    run(['--codex', '--project'])
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Installation complete'))
  })

  it('installs to custom path with --path <dir>', () => {
    mockExistsSync.mockReturnValue(true)
    run(['--path', '/custom/dir'])
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Installation complete'))
  })

  it('exits 1 when --path has no argument', () => {
    mockExit.mockImplementation(() => {
      throw new Error('process.exit(1)')
    })
    expect(() => run(['--path'])).toThrow('process.exit(1)')
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('--path requires'))
  })

  it('exits 1 when skills source not found', () => {
    mockExistsSync.mockReturnValue(false)
    run(['--claude-code'])
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Skills source not found'))
    expect(mockExit).toHaveBeenCalledWith(1)
  })

  it('creates target directory when it does not exist', () => {
    mockExistsSync
      .mockReturnValueOnce(true) // source exists
      .mockReturnValueOnce(false) // target dir does not exist
    run(['--claude-code'])
    expect(mockMkdirSync).toHaveBeenCalled()
  })

  it('exits 1 on unknown option', () => {
    run(['--unknown-flag'])
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Unknown option'))
    expect(mockExit).toHaveBeenCalledWith(1)
  })
})
