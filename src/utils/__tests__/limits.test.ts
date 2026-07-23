// Unit tests for utils/limits.ts — validates constant values and invariants

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_FILE_SIZE,
  MAX_FILE_SIZE_LIMIT,
  MAX_INGEST_DATA_SIZE,
  MAX_SCAN_DEPTH,
  SKIP_DIR_NAMES,
} from '../../utils/limits.js'

describe('limits', () => {
  it('MAX_SCAN_DEPTH is a positive integer', () => {
    expect(MAX_SCAN_DEPTH).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_SCAN_DEPTH)).toBe(true)
  })

  it('DEFAULT_MAX_FILE_SIZE is 100 MB', () => {
    expect(DEFAULT_MAX_FILE_SIZE).toBe(100 * 1024 * 1024)
  })

  it('MAX_FILE_SIZE_LIMIT is 500 MB and greater than default', () => {
    expect(MAX_FILE_SIZE_LIMIT).toBe(500 * 1024 * 1024)
    expect(MAX_FILE_SIZE_LIMIT).toBeGreaterThan(DEFAULT_MAX_FILE_SIZE)
  })

  it('MAX_INGEST_DATA_SIZE matches DEFAULT_MAX_FILE_SIZE', () => {
    expect(MAX_INGEST_DATA_SIZE).toBe(DEFAULT_MAX_FILE_SIZE)
  })

  it('SKIP_DIR_NAMES includes common VCS and build directories', () => {
    expect(SKIP_DIR_NAMES.has('.git')).toBe(true)
    expect(SKIP_DIR_NAMES.has('node_modules')).toBe(true)
    expect(SKIP_DIR_NAMES.has('dist')).toBe(true)
    expect(SKIP_DIR_NAMES.has('build')).toBe(true)
    expect(SKIP_DIR_NAMES.has('.next')).toBe(true)
    expect(SKIP_DIR_NAMES.has('__pycache__')).toBe(true)
  })

  it('SKIP_DIR_NAMES values are all lowercase (convention)', () => {
    for (const name of SKIP_DIR_NAMES) {
      expect(name).toBe(name.toLowerCase())
    }
  })

  it('SKIP_DIR_NAMES does not contain empty strings', () => {
    for (const name of SKIP_DIR_NAMES) {
      expect(name.length).toBeGreaterThan(0)
    }
  })
})
