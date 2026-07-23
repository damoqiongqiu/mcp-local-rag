/**
 * Generic LRU (Least Recently Used) cache with TTL expiration.
 *
 * Used by the search handler to cache embedding vectors and search
 * results, avoiding redundant computation when the same query is
 * repeated (common in AI coding assistant workflows).
 */

export interface CacheEntry<T> {
  value: T
  /** Unix timestamp (ms) when this entry was created */
  createdAt: number
}

export interface LruCacheOptions {
  /** Maximum number of entries before eviction */
  maxSize?: number
  /** Time-to-live in milliseconds (0 = no expiry) */
  ttlMs?: number
}

export class LruCache<T> {
  private readonly maxSize: number
  private readonly ttlMs: number
  private readonly map = new Map<string, CacheEntry<T>>()

  constructor(options: LruCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 128
    this.ttlMs = options.ttlMs ?? 0
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined

    // TTL check
    if (this.ttlMs > 0 && Date.now() - entry.createdAt > this.ttlMs) {
      this.map.delete(key)
      return undefined
    }

    // Move to end (most recently used)
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    // Evict oldest if at capacity (only if adding a new key)
    if (!this.map.has(key) && this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) {
        this.map.delete(oldest)
      }
    }

    // Remove existing entry for this key (to update MRU position)
    this.map.delete(key)
    this.map.set(key, { value, createdAt: Date.now() })
  }

  /** Remove all entries matching a prefix (for targeted invalidation). */
  invalidateByPrefix(prefix: string): number {
    let count = 0
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.map.delete(key)
        count++
      }
    }
    return count
  }

  /** Remove a specific key. Returns true if the key existed. */
  delete(key: string): boolean {
    return this.map.delete(key)
  }

  /** Remove all entries. */
  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}
