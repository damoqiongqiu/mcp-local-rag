// Unit tests for LruCache

import { describe, expect, it } from 'vitest'
import { LruCache } from '../lru-cache.js'

describe('LruCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LruCache<string>({ maxSize: 10 })
    cache.set('a', 'value-a')
    expect(cache.get('a')).toBe('value-a')
  })

  it('returns undefined for missing keys', () => {
    const cache = new LruCache<string>({ maxSize: 10 })
    expect(cache.get('missing')).toBeUndefined()
  })

  it('evicts oldest entry when at capacity', () => {
    const cache = new LruCache<string>({ maxSize: 2 })
    cache.set('a', 'first')
    cache.set('b', 'second')
    cache.set('c', 'third')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('second')
    expect(cache.get('c')).toBe('third')
  })

  it('promotes accessed entries (LRU semantics)', () => {
    const cache = new LruCache<string>({ maxSize: 2 })
    cache.set('a', 'first')
    cache.set('b', 'second')
    cache.get('a') // promote 'a'
    cache.set('c', 'third') // should evict 'b'
    expect(cache.get('a')).toBe('first')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('third')
  })

  it('overwrites existing keys and promotes them', () => {
    const cache = new LruCache<string>({ maxSize: 2 })
    cache.set('a', 'first')
    cache.set('b', 'second')
    cache.set('a', 'updated')
    cache.set('c', 'third')
    expect(cache.get('a')).toBe('updated')
    expect(cache.get('b')).toBeUndefined()
  })

  it('expires entries after TTL', async () => {
    const cache = new LruCache<string>({ maxSize: 10, ttlMs: 50 })
    cache.set('a', 'value')
    expect(cache.get('a')).toBe('value')
    await new Promise((r) => setTimeout(r, 60))
    expect(cache.get('a')).toBeUndefined()
  })

  it('reports correct size', () => {
    const cache = new LruCache<string>({ maxSize: 100 })
    expect(cache.size).toBe(0)
    cache.set('a', '1')
    cache.set('b', '2')
    expect(cache.size).toBe(2)
    cache.set('a', 'updated')
    expect(cache.size).toBe(2)
  })

  it('clear() removes all entries', () => {
    const cache = new LruCache<string>({ maxSize: 10 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('delete() removes a specific key', () => {
    const cache = new LruCache<string>({ maxSize: 10 })
    cache.set('a', '1')
    cache.set('b', '2')
    expect(cache.delete('a')).toBe(true)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(1)
    expect(cache.delete('missing')).toBe(false)
  })

  it('invalidateByPrefix removes matching keys', () => {
    const cache = new LruCache<string>({ maxSize: 10 })
    cache.set('q:hello|l:10', 'result1')
    cache.set('q:hello|l:20', 'result2')
    cache.set('other', 'result3')
    cache.invalidateByPrefix('q:')
    expect(cache.get('other')).toBe('result3')
    expect(cache.get('q:hello|l:10')).toBeUndefined()
    expect(cache.get('q:hello|l:20')).toBeUndefined()
  })
})
