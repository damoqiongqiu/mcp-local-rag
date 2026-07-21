// Unit tests for the RAG_INSTANCES JSON parser.

import { describe, expect, it } from 'vitest'
import { parseRagInstances } from '../parser.js'

// ============================================
// parseRagInstances
// ============================================

describe('parseRagInstances', () => {
  // --- Happy path ---

  it('parses a valid JSON array with all fields', () => {
    const result = parseRagInstances('[{"name":"app","baseDir":"/tmp/app","dbPath":"./db"}]')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual([{ name: 'app', baseDir: '/tmp/app', dbPath: './db' }])
    }
  })

  it('parses multiple instances', () => {
    const result = parseRagInstances(
      '[{"name":"a","baseDir":"/tmp/a","dbPath":"./db1"},{"name":"b","baseDir":"/tmp/b","dbPath":"./db2"}]'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(2)
    }
  })

  it('derives name from the last path segment of baseDir when name is absent', () => {
    const result = parseRagInstances('[{"baseDir":"/tmp/my-app","dbPath":"./db"}]')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value[0]?.name).toBe('my-app')
    }
  })

  it('derives name from the last segment when baseDir has a trailing slash', () => {
    const result = parseRagInstances('[{"baseDir":"/tmp/my-app/","dbPath":"./db"}]')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value[0]?.name).toBe('my-app')
    }
  })

  it('uses baseDir as name when baseDir has no parent segment', () => {
    const result = parseRagInstances('[{"baseDir":"/","dbPath":"./db"}]')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // basename('/') returns '' on some platforms, so fallback is '/'
      expect(result.value[0]?.name).not.toBe('')
    }
  })

  // --- JSON format errors ---

  it('rejects non-JSON input', () => {
    const result = parseRagInstances('not json at all')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/not valid JSON/)
    }
  })

  it('rejects a JSON object (not an array)', () => {
    const result = parseRagInstances('{"name":"a"}')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/must be a JSON array/)
      expect(result.error).toMatch(/received object/)
    }
  })

  it('rejects a JSON null', () => {
    const result = parseRagInstances('null')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/must be a JSON array/)
      expect(result.error).toMatch(/received null/)
    }
  })

  it('rejects a JSON string scalar', () => {
    const result = parseRagInstances('"/tmp/a"')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/must be a JSON array/)
    }
  })

  it('rejects an empty array', () => {
    const result = parseRagInstances('[]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/must not be an empty array/)
    }
  })

  it('truncates long invalid input in error message', () => {
    const long = 'x'.repeat(200)
    const result = parseRagInstances(long)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.length).toBeLessThan(long.length + 50)
    }
  })

  // --- Missing fields ---

  it('rejects when baseDir is missing', () => {
    const result = parseRagInstances('[{"name":"a","dbPath":"./db"}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\] is missing required field: baseDir/)
    }
  })

  it('rejects when dbPath is missing', () => {
    const result = parseRagInstances('[{"name":"a","baseDir":"/tmp/a"}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\] is missing required field: dbPath/)
    }
  })

  // --- Field type errors ---

  it('rejects when baseDir is not a string', () => {
    const result = parseRagInstances('[{"name":"a","baseDir":123,"dbPath":"./db"}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\]\.baseDir must be a string/)
      expect(result.error).toMatch(/received number/)
    }
  })

  it('rejects when dbPath is not a string', () => {
    const result = parseRagInstances('[{"name":"a","baseDir":"/tmp/a","dbPath":null}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\]\.dbPath must be a string/)
      expect(result.error).toMatch(/received null/)
    }
  })

  it('rejects when name is provided but not a string', () => {
    const result = parseRagInstances('[{"name":true,"baseDir":"/tmp/a","dbPath":"./db"}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\]\.name must be a string/)
    }
  })

  // --- Empty string errors ---

  it('rejects when baseDir is empty', () => {
    const result = parseRagInstances('[{"name":"a","baseDir":"","dbPath":"./db"}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\]\.baseDir must not be empty/)
    }
  })

  it('rejects when baseDir is whitespace-only', () => {
    const result = parseRagInstances('[{"name":"a","baseDir":"   ","dbPath":"./db"}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\]\.baseDir must not be empty/)
    }
  })

  it('rejects when dbPath is empty', () => {
    const result = parseRagInstances('[{"name":"a","baseDir":"/tmp/a","dbPath":""}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\]\.dbPath must not be empty/)
    }
  })

  it('rejects when name is provided as empty string', () => {
    const result = parseRagInstances('[{"name":"","baseDir":"/tmp/a","dbPath":"./db"}]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\]\.name must not be empty/)
    }
  })

  // --- Duplicate name ---

  it('rejects duplicate names', () => {
    const result = parseRagInstances(
      '[{"name":"dup","baseDir":"/a","dbPath":"./db1"},{"name":"dup","baseDir":"/b","dbPath":"./db2"}]'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(
        /RAG_INSTANCES\[0\] and RAG_INSTANCES\[1\] have duplicate name: dup/
      )
    }
  })

  it('detects duplicate names across non-adjacent entries', () => {
    const result = parseRagInstances(
      '[{"name":"dup","baseDir":"/a","dbPath":"./db1"},{"name":"x","baseDir":"/x","dbPath":"./db2"},{"name":"dup","baseDir":"/b","dbPath":"./db3"}]'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(
        /RAG_INSTANCES\[0\] and RAG_INSTANCES\[2\] have duplicate name: dup/
      )
    }
  })

  // --- Index accuracy in multi-element arrays ---

  it('reports the correct index for errors in non-first elements', () => {
    const result = parseRagInstances(
      '[{"name":"a","baseDir":"/a","dbPath":"./db"},{"name":"b","baseDir":"/b"}]'
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[1\]/)
    }
  })

  // --- Edge cases ---

  it('trims whitespace around the outer JSON', () => {
    const result = parseRagInstances('  [{"name":"a","baseDir":"/tmp/a","dbPath":"./db"}]  ')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(1)
    }
  })

  it('trims whitespace from string field values', () => {
    const result = parseRagInstances('[{"name":"  a  ","baseDir":"  /tmp/a  ","dbPath":"./db"}]')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value[0]?.name).toBe('a')
      expect(result.value[0]?.baseDir).toBe('/tmp/a')
    }
  })

  it('rejects when an array element is not an object', () => {
    const result = parseRagInstances('["not an object"]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\] must be an object/)
    }
  })

  it('rejects when an array element is null', () => {
    const result = parseRagInstances('[null]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/RAG_INSTANCES\[0\] must be an object/)
    }
  })
})
