// Unit tests for the instance configuration resolver.

import { resolve as pathResolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { legacyBaseDir, resolveInstances } from '../resolver.js'
import { InstanceConfigError } from '../types.js'

// ============================================
// Mock realpath from node:fs/promises
// ============================================

const { realpathMock } = vi.hoisted(() => {
  // Detect platform separator at runtime inside hoisted scope
  const sepa = process.platform === 'win32' ? '\\' : '/'

  const knownPaths = [
    '/tmp/app',
    '/tmp/parent',
    '/tmp/parent/child',
    '/tmp/instance-a',
    '/tmp/instance-b',
    '/tmp/single',
    '/tmp/legacy-a',
    '/tmp/legacy-b',
  ]

  const realpathMock = vi.fn(async (p: string) => {
    const normalized = p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    const match = knownPaths.find((kp) => normalized === kp)
    if (match) return match.replace(/\//g, sepa)
    if (normalized === '/private/tmp/app') return '/private/tmp/app'
    if (normalized === '/private/tmp/parent') return '/private/tmp/parent'
    if (normalized === '/private/tmp/parent/child') return '/private/tmp/parent/child'
    throw new Error(`ENOENT: no such file or directory, '${p}'`)
  })

  return { realpathMock }
})

vi.mock('node:fs/promises', () => ({
  realpath: realpathMock,
}))

const cwd = '/fake/cwd'

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================
// resolveInstances
// ============================================

describe('resolveInstances', () => {
  // ---- RAG_INSTANCES: multi-instance ----

  describe('RAG_INSTANCES multi-instance', () => {
    it('resolves multiple instances from RAG_INSTANCES', async () => {
      const result = await resolveInstances(
        {
          RAG_INSTANCES:
            '[{"name":"a","baseDir":"/tmp/instance-a","dbPath":"./db-a"},{"name":"b","baseDir":"/tmp/instance-b","dbPath":"./db-b"}]',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances).toHaveLength(2)
        expect(result.instances[0]?.name).toBe('a')
        expect(result.instances[0]?.baseDir).toMatch(/instance-a[/\\]$/)
        expect(result.instances[0]?.dbPath).toBe(pathResolve(cwd, 'db-a'))
        expect(result.instances[1]?.name).toBe('b')
        expect(result.instances[1]?.baseDir).toMatch(/instance-b[/\\]$/)
        expect(result.instances[1]?.dbPath).toBe(pathResolve(cwd, 'db-b'))
      }
    })

    it('derives name from baseDir when name is absent', async () => {
      const result = await resolveInstances(
        {
          RAG_INSTANCES: '[{"baseDir":"/tmp/app","dbPath":"./db"}]',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances[0]?.name).toBe('app')
      }
    })

    it('returns an error for malformed RAG_INSTANCES', async () => {
      const result = await resolveInstances({ RAG_INSTANCES: 'not json' }, cwd)
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.error).toBeInstanceOf(InstanceConfigError)
        expect(result.error.message).toMatch(/not valid JSON/)
      }
    })

    it('returns an error when baseDir realpath fails', async () => {
      const result = await resolveInstances(
        {
          RAG_INSTANCES: '[{"name":"x","baseDir":"/nonexistent/dir","dbPath":"./db"}]',
        },
        cwd
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.error).toBeInstanceOf(InstanceConfigError)
        expect(result.error.message).toMatch(/Failed to resolve base directory/)
      }
    })

    it('returns an error for sensitive baseDir paths', async () => {
      const result = await resolveInstances(
        {
          RAG_INSTANCES: '[{"name":"x","baseDir":"/etc/config","dbPath":"./db"}]',
        },
        cwd
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.error).toBeInstanceOf(InstanceConfigError)
        expect(result.error.message).toMatch(/Refusing to use sensitive system path/)
      }
    })

    it('warns when one instance baseDir is nested inside another', async () => {
      const result = await resolveInstances(
        {
          RAG_INSTANCES:
            '[{"name":"parent","baseDir":"/tmp/parent","dbPath":"./db1"},{"name":"child","baseDir":"/tmp/parent/child","dbPath":"./db2"}]',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0]?.kind).toBe('nested-base-dir')
      }
    })

    it('warns when two instances share the same dbPath', async () => {
      const result = await resolveInstances(
        {
          RAG_INSTANCES:
            '[{"name":"a","baseDir":"/tmp/instance-a","dbPath":"./same-db"},{"name":"b","baseDir":"/tmp/instance-b","dbPath":"./same-db"}]',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0]?.kind).toBe('db-path-conflict')
        expect(result.warnings[0]?.message).toMatch(/share the same dbPath/)
      }
    })

    it('resolves dbPath relative to cwd', async () => {
      const result = await resolveInstances(
        {
          RAG_INSTANCES: '[{"name":"x","baseDir":"/tmp/app","dbPath":"data/vectors"}]',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances[0]?.dbPath).toBe(pathResolve(cwd, 'data/vectors'))
      }
    })
  })

  // ---- BASE_DIRS: legacy deprecation ----

  describe('BASE_DIRS legacy', () => {
    it('falls back to single instance with deprecation warning', async () => {
      const result = await resolveInstances(
        {
          BASE_DIRS: '["/tmp/legacy-a"]',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances).toHaveLength(1)
        expect(result.instances[0]?.name).toBe('legacy-a')
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0]?.kind).toBe('base-dirs-deprecated')
      }
    })

    it('uses the first root from BASE_DIRS', async () => {
      const result = await resolveInstances(
        {
          BASE_DIRS: '["/tmp/legacy-a","/tmp/legacy-b"]',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances).toHaveLength(1)
        expect(result.instances[0]?.name).toBe('legacy-a')
      }
    })
  })

  // ---- BASE_DIR: single instance backward compatibility ----

  describe('BASE_DIR single', () => {
    it('resolves a single instance from BASE_DIR', async () => {
      const result = await resolveInstances({ BASE_DIR: '/tmp/single' }, cwd)
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances).toHaveLength(1)
        expect(result.instances[0]?.name).toBe('single')
        expect(result.warnings).toEqual([])
      }
    })

    it('resolves dbPath from DB_PATH env', async () => {
      const result = await resolveInstances({ BASE_DIR: '/tmp/app', DB_PATH: '/custom/db' }, cwd)
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances[0]?.dbPath).toBe(pathResolve(cwd, '/custom/db'))
      }
    })
  })

  // ---- Precedence ----

  describe('precedence', () => {
    it('RAG_INSTANCES takes precedence over BASE_DIRS and BASE_DIR', async () => {
      const result = await resolveInstances(
        {
          RAG_INSTANCES: '[{"name":"app","baseDir":"/tmp/app","dbPath":"./db"}]',
          BASE_DIRS: '["/tmp/legacy-a"]',
          BASE_DIR: '/tmp/single',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances).toHaveLength(1)
        expect(result.instances[0]?.name).toBe('app')
        // No deprecation warning since we used RAG_INSTANCES
        expect(result.warnings).toEqual([])
      }
    })

    it('BASE_DIRS takes precedence over BASE_DIR', async () => {
      const result = await resolveInstances(
        {
          BASE_DIRS: '["/tmp/legacy-a"]',
          BASE_DIR: '/tmp/single',
        },
        cwd
      )
      expect('error' in result && result.error).toBeFalsy()
      if ('instances' in result) {
        expect(result.instances[0]?.name).toBe('legacy-a')
        expect(result.warnings[0]?.kind).toBe('base-dirs-deprecated')
      }
    })
  })

  // ---- No config ----

  describe('no config', () => {
    it('returns an error when no base directory is configured', async () => {
      const result = await resolveInstances({}, cwd)
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.error).toBeInstanceOf(InstanceConfigError)
        expect(result.error.message).toBe('No base directory configured')
      }
    })

    it('returns an error when all env vars are empty strings', async () => {
      const result = await resolveInstances({ RAG_INSTANCES: '', BASE_DIRS: '', BASE_DIR: '' }, cwd)
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.error.message).toBe('No base directory configured')
      }
    })
  })
})

// ============================================
// legacyBaseDir
// ============================================

describe('legacyBaseDir', () => {
  it('returns the first root from BASE_DIRS', () => {
    expect(legacyBaseDir('["/a","/b"]')).toBe('/a')
  })

  it('throws for invalid BASE_DIRS', () => {
    expect(() => legacyBaseDir('not json')).toThrow()
  })
})
