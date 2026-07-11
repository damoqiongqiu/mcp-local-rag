// model-registry unit tests

import { describe, expect, it } from 'vitest'
import {
  isAlias,
  KNOWN_MODELS,
  MODEL_ALIASES,
  modelSizeHint,
  resolveModel,
  validateModelAdvisory,
} from '../model-registry.js'

describe('model-registry', () => {
  describe('resolveModel', () => {
    it('should return canonical name and entry for known full paths', () => {
      const result = resolveModel('Xenova/all-MiniLM-L6-v2')
      expect(result.name).toBe('Xenova/all-MiniLM-L6-v2')
      expect(result.entry?.approxSizeMb).toBe(90)
      expect(result.entry?.dimension).toBe(384)
    })

    it('should resolve aliases to canonical names', () => {
      expect(resolveModel('mini').name).toBe('Xenova/all-MiniLM-L6-v2')
      expect(resolveModel('MINI').name).toBe('Xenova/all-MiniLM-L6-v2')
      expect(resolveModel('mpnet').name).toBe('Xenova/all-mpnet-base-v2')
      expect(resolveModel('bge-small').name).toBe('Xenova/bge-small-en-v1.5')
    })

    it('should return null entry for unknown models', () => {
      const result = resolveModel('custom/unknown-model')
      expect(result.name).toBe('custom/unknown-model')
      expect(result.entry).toBeNull()
    })

    it('should not confuse substrings', () => {
      // "mini-l12" is its own alias → all-MiniLM-L12-v2
      expect(resolveModel('mini-l12').name).toBe('Xenova/all-MiniLM-L12-v2')
      // "mini" without "-l12" still resolves to L6
      expect(resolveModel('mini').name).toBe('Xenova/all-MiniLM-L6-v2')
    })
  })

  describe('modelSizeHint', () => {
    it('should return "~90MB" for known small model', () => {
      expect(modelSizeHint('Xenova/all-MiniLM-L6-v2')).toBe('~90MB')
    })

    it('should return "~420MB" for large model', () => {
      expect(modelSizeHint('Xenova/all-mpnet-base-v2')).toBe('~420MB')
    })

    it('should return "unknown size" for unknown model', () => {
      expect(modelSizeHint('custom/unknown')).toBe('unknown size')
    })

    it('should work through aliases', () => {
      expect(modelSizeHint('mini')).toBe('~90MB')
    })
  })

  describe('isAlias', () => {
    it('should identify known aliases', () => {
      expect(isAlias('mini')).toBe(true)
      expect(isAlias('mpnet')).toBe(true)
    })

    it('should be case-insensitive', () => {
      expect(isAlias('MINI')).toBe(true)
      expect(isAlias('MpNeT')).toBe(true)
    })

    it('should return false for full paths', () => {
      expect(isAlias('Xenova/all-MiniLM-L6-v2')).toBe(false)
    })
  })

  describe('validateModelAdvisory', () => {
    it('should return undefined for known models', () => {
      expect(validateModelAdvisory('Xenova/all-MiniLM-L6-v2')).toBeUndefined()
    })

    it('should return a warning for unknown models', () => {
      const warning = validateModelAdvisory('custom/unknown')
      expect(warning).toBeDefined()
      expect(warning!).toContain('not in the known-model list')
      expect(warning!).toContain('Known models:')
    })
  })

  describe('KNOWN_MODELS', () => {
    it('should have unique names', () => {
      const names = KNOWN_MODELS.map((m) => m.name)
      expect(new Set(names).size).toBe(names.length)
    })

    it('should have all required fields', () => {
      for (const m of KNOWN_MODELS) {
        expect(m.name).toBeTruthy()
        expect(m.label).toBeTruthy()
        expect(m.approxSizeMb).toBeGreaterThan(0)
        expect(m.dimension).toBeGreaterThan(0)
      }
    })
  })

  describe('MODEL_ALIASES', () => {
    it('every alias should resolve to a known model', () => {
      for (const [alias, target] of Object.entries(MODEL_ALIASES)) {
        const entry = KNOWN_MODELS.find((m) => m.name === target)
        expect(entry, `Alias "${alias}" → "${target}" not in KNOWN_MODELS`).toBeDefined()
      }
    })
  })
})
