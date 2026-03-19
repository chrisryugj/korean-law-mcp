/**
 * Simple in-memory cache for law data
 * 자주 조회되는 법령 데이터를 캐싱하여 API 호출 절약
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number // time to live in milliseconds
}

export class SimpleCache {
  private cache: Map<string, CacheEntry<any>>
  private maxSize: number

  constructor(maxSize: number = 100) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  set<T>(key: string, data: T, ttl: number = 24 * 60 * 60 * 1000): void {
    // TTL default: 24 hours

    // If cache is full, evict expired entries first, then oldest
    if (this.cache.size >= this.maxSize) {
      this.evictOne()
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })
  }

  /** 만료 엔트리 우선 제거, 없으면 LRU(가장 오래된) 제거 */
  private evictOne(): void {
    const now = Date.now()
    // 1차: 만료된 엔트리 찾아서 제거
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
        return
      }
    }
    // 2차: 만료 없으면 Map 순서상 첫 번째(가장 오래된) 제거
    const oldestKey = this.cache.keys().next().value
    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if expired
    const now = Date.now()
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }

    // LRU 승격: Map 순서 끝으로 이동
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.data as T
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    // Check if expired
    const now = Date.now()
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
      }
    }
  }
}

// Global cache instance
// 64개 도구 × 다양한 쿼리 조합 → maxSize=100은 빈번한 eviction 유발
// 법령 데이터는 변경 빈도가 낮아 캐시 적중률이 높으므로 넉넉하게 설정
export const lawCache = new SimpleCache(500)

// Cleanup expired entries every hour
setInterval(() => {
  lawCache.cleanup()
}, 60 * 60 * 1000).unref()
