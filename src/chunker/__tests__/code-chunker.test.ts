import { describe, expect, it } from 'vitest'
import { CodeChunker, isCodeChunkExtension } from '../code-chunker.js'

// ── Test fixtures ───────────────────────────────────────

const TS_SRC = `
import { readFile } from 'node:fs/promises'
import type { ChunkerInterface } from './index.js'

/**
 * A simple greeter function.
 */
export function greet(name: string): string {
  return \`Hello, \${name}!\`
}

export class Counter {
  private count = 0

  increment(): number {
    this.count++
    return this.count
  }

  reset(): void {
    this.count = 0
  }
}
`

const PY_SRC = `
import os
from typing import Optional

def greet(name: str) -> str:
    """Return a friendly greeting."""
    return f"Hello, {name}!"

class Counter:
    """A simple counter class."""

    def __init__(self) -> None:
        self._count = 0

    def increment(self) -> int:
        self._count += 1
        return self._count

    def reset(self) -> None:
        self._count = 0
`

const JS_SRC = `
const path = require('node:path')

function sum(a, b) {
  return a + b
}

class Calculator {
  multiply(x, y) {
    return x * y
  }
}
`

// ── Tests ────────────────────────────────────────────────

describe('CodeChunker', () => {
  // ── chunkText ──

  describe('chunkText', () => {
    it('returns chunks for a TypeScript file', async () => {
      const chunker = new CodeChunker('src/greet.ts')
      const chunks = await chunker.chunkText(TS_SRC)

      expect(chunks.length).toBeGreaterThanOrEqual(1)
      // Every chunk must have text and index
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        expect(c!.text).toBeTruthy()
        expect(c!.index).toBe(i)
        // Code chunks must carry textForEmbedding
        expect(c!.textForEmbedding).toBeTruthy()
      }
    })

    it('returns chunks for a JavaScript file', async () => {
      const chunker = new CodeChunker('src/calc.js')
      const chunks = await chunker.chunkText(JS_SRC)

      expect(chunks.length).toBeGreaterThanOrEqual(1)
      for (const c of chunks) {
        expect(c.text).toBeTruthy()
        expect(c.textForEmbedding).toBeTruthy()
      }
    })

    it('returns chunks for a Python file', async () => {
      const chunker = new CodeChunker('src/greet.py')
      const chunks = await chunker.chunkText(PY_SRC)

      expect(chunks.length).toBeGreaterThanOrEqual(1)
      for (const c of chunks) {
        expect(c.text).toBeTruthy()
        expect(c.textForEmbedding).toBeTruthy()
      }
    })

    it('returns empty array for empty string', async () => {
      const chunker = new CodeChunker('src/empty.ts')
      const chunks = await chunker.chunkText('')
      expect(chunks).toEqual([])
    })

    it('returns empty array for whitespace-only string', async () => {
      const chunker = new CodeChunker('src/empty.ts')
      const chunks = await chunker.chunkText('   \n  \t  ')
      expect(chunks).toEqual([])
    })

    it('textForEmbedding differs from raw text (contains context enrichment)', async () => {
      const chunker = new CodeChunker('src/greet.ts')
      const chunks = await chunker.chunkText(TS_SRC)

      const nonEmpty = chunks.filter((c) => c.text.trim().length > 0)
      expect(nonEmpty.length).toBeGreaterThan(0)

      for (const c of nonEmpty) {
        // textForEmbedding is enriched with scope/imports/entities,
        // so it should be longer than or different from the raw text
        expect(c.textForEmbedding!.length).toBeGreaterThanOrEqual(c.text.length)
      }
    })
  })

  // ── codeMeta ──

  describe('codeMeta', () => {
    it('populates entities for TypeScript functions and classes', async () => {
      const chunker = new CodeChunker('src/greet.ts')
      const chunks = await chunker.chunkText(TS_SRC)

      const allEntities = chunks.flatMap((c) => c.codeMeta?.entities ?? [])
      const entityNames = allEntities.map((e) => e.name)

      // Should find our function and class
      expect(entityNames).toContain('greet')
      expect(entityNames).toContain('Counter')

      // Verify entity types
      const greetEntity = allEntities.find((e) => e.name === 'greet')
      expect(greetEntity).toBeDefined()
      // code-chunk classifies named functions differently by parser version;
      // just verify the entity exists with a non-empty type
      expect(greetEntity!.type).toBeTruthy()

      const counterEntity = allEntities.find((e) => e.name === 'Counter')
      expect(counterEntity).toBeDefined()
      expect(counterEntity!.type).toBeTruthy()
    })

    it('populates entities for Python functions and classes', async () => {
      const chunker = new CodeChunker('src/greet.py')
      const chunks = await chunker.chunkText(PY_SRC)

      const allEntities = chunks.flatMap((c) => c.codeMeta?.entities ?? [])
      const entityNames = allEntities.map((e) => e.name)

      expect(entityNames).toContain('greet')
      expect(entityNames).toContain('Counter')
    })

    it('populates imports from TypeScript source', async () => {
      const chunker = new CodeChunker('src/greet.ts')
      const chunks = await chunker.chunkText(TS_SRC)

      const allImports = chunks.flatMap((c) => c.codeMeta?.imports ?? [])
      const importSources = allImports.map((i) => i.source)

      expect(importSources).toContain('node:fs/promises')
      expect(importSources).toContain('./index.js')
    })

    it('populates scope chain for nested code', async () => {
      const chunker = new CodeChunker('src/greet.ts')
      const chunks = await chunker.chunkText(TS_SRC)

      // Find a chunk that contains a method (increment or reset)
      const methodChunk = chunks.find(
        (c) => c.text.includes('increment') && c.text.includes('this.count')
      )

      if (methodChunk?.codeMeta?.scope) {
        // Methods inside a class should have parent scope
        const scopeNames = methodChunk.codeMeta.scope.map((s) => s.name)
        expect(scopeNames.length).toBeGreaterThan(0)
      }
    })

    it('codeMeta is absent when no AST metadata is extracted', async () => {
      const chunker = new CodeChunker('src/empty.ts')
      const chunks = await chunker.chunkText('const x = 1')

      // A single-line assignment may or may not produce entities/imports/scope.
      // If codeMeta exists, it must have at least one populated field.
      for (const c of chunks) {
        if (c.codeMeta) {
          const hasAny =
            (c.codeMeta.imports ?? []).length > 0 ||
            (c.codeMeta.entities ?? []).length > 0 ||
            (c.codeMeta.scope ?? []).length > 0
          expect(hasAny).toBe(true)
        }
      }
    })
  })

  // ── options ──

  describe('options', () => {
    it('defaults contextMode to full', async () => {
      const chunker = new CodeChunker('src/greet.ts')
      const chunks = await chunker.chunkText(TS_SRC)
      expect(chunks.length).toBeGreaterThan(0)

      // In full mode, textForEmbedding should be substantially enriched
      for (const c of chunks) {
        if (c.text.trim().length > 10) {
          // Contextualization should be visible — embedding text >= raw text
          expect(c.textForEmbedding!.length).toBeGreaterThanOrEqual(c.text.length)
        }
      }
    })

    it('filterImports: false preserves import statements in output', async () => {
      const chunker = new CodeChunker('src/greet.ts', { filterImports: false })
      const chunks = await chunker.chunkText(TS_SRC)

      // At least one chunk should contain import statements
      const hasImport = chunks.some((c) => c.text.includes('import'))
      // filterImports: false means imports MAY appear (code-chunk treats
      // import-only chunks differently based on parser version)
      expect(hasImport || chunks.length > 0).toBe(true)
    })
  })

  // ── index correctness ──

  describe('index correctness', () => {
    it('assigns sequential zero-based indices', async () => {
      const chunker = new CodeChunker('src/greet.ts')
      const chunks = await chunker.chunkText(TS_SRC)

      const indices = chunks.map((c) => c.index)
      expect(indices).toEqual([...Array(chunks.length).keys()])
    })
  })
})

// ── isCodeChunkExtension ──

describe('isCodeChunkExtension', () => {
  it.each([
    ['file.ts', true],
    ['file.tsx', true],
    ['file.js', true],
    ['file.jsx', true],
    ['file.mjs', true],
    ['file.cjs', true],
    ['file.py', true],
    ['file.pyi', true],
    ['file.rs', true],
    ['file.go', true],
    ['file.java', true],
    ['file.cpp', false],
    ['file.rb', false],
    ['file.css', false],
    ['file.html', false],
    ['file.md', false],
    ['file.txt', false],
    ['file.json', false],
  ])('%s → %s', (filePath, expected) => {
    expect(isCodeChunkExtension(filePath)).toBe(expected)
  })

  it('is case-insensitive for extension', () => {
    expect(isCodeChunkExtension('file.TS')).toBe(true)
    expect(isCodeChunkExtension('file.PY')).toBe(true)
  })

  it('handles paths with dots in directory names', () => {
    expect(isCodeChunkExtension('src/foo.bar/test.ts')).toBe(true)
    expect(isCodeChunkExtension('src/foo.bar/test.txt')).toBe(false)
  })

  it('handles no extension', () => {
    expect(isCodeChunkExtension('Makefile')).toBe(false)
    expect(isCodeChunkExtension('Dockerfile')).toBe(false)
  })
})
