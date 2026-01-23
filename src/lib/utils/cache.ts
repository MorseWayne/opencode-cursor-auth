/**
 * LRU Cache Utilities
 *
 * Provides memory-efficient caching with:
 * - Least Recently Used eviction
 * - Time-based expiration (TTL)
 * - Size limits
 * - Optional dispose callbacks
 */

// --- Types ---

export interface LRUCacheOptions<V> {
  /** Maximum number of items in cache */
  max: number;
  /** Time-to-live in milliseconds (0 = no expiration) */
  ttl?: number;
  /** Callback when an item is evicted (can be sync or async) */
  onEvict?: (key: string, value: V) => void | Promise<void>;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number | null;
}

// --- LRU Cache Implementation ---

/**
 * Simple LRU Cache with TTL support
 *
 * @example
 * ```ts
 * const cache = new LRUCache<User>({ max: 100, ttl: 60000 });
 *
 * cache.set("user:1", { id: 1, name: "Alice" });
 * const user = cache.get("user:1");
 *
 * // With dispose callback
 * const sessions = new LRUCache<Session>({
 *   max: 50,
 *   ttl: 15 * 60 * 1000,
 *   onEvict: (key, session) => session.close(),
 * });
 * ```
 */
export class LRUCache<V> {
  private cache: Map<string, CacheEntry<V>>;
  private max: number;
  private ttl: number;
  private onEvict?: (key: string, value: V) => void | Promise<void>;
  /** Track pending async cleanup operations to avoid dangling promises */
  private pendingCleanups: Set<Promise<void>> = new Set();

  constructor(options: LRUCacheOptions<V>) {
    this.cache = new Map();
    this.max = options.max;
    this.ttl = options.ttl ?? 0;
    this.onEvict = options.onEvict;
  }

  /**
   * Get an item from the cache
   * Returns undefined if not found or expired
   */
  get(key: string): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check expiration
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set an item in the cache
   */
  set(key: string, value: V, ttl?: number): this {
    // Delete existing entry if present
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.max) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.delete(oldestKey);
      }
    }

    // Calculate expiration
    const effectiveTtl = ttl ?? this.ttl;
    const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : null;

    // Add new entry
    this.cache.set(key, { value, expiresAt });

    return this;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete an item from the cache (sync version)
   * Note: If onEvict is async, it will be scheduled but not awaited
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry && this.onEvict) {
      const result = this.onEvict(key, entry.value);
      // Track async cleanup to prevent dangling promises
      if (result instanceof Promise) {
        this.pendingCleanups.add(result);
        result.finally(() => this.pendingCleanups.delete(result));
      }
    }
    return this.cache.delete(key);
  }

  /**
   * Delete an item from the cache (async version)
   * Awaits the onEvict callback if it returns a promise
   */
  async deleteAsync(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (entry && this.onEvict) {
      await this.onEvict(key, entry.value);
    }
    return this.cache.delete(key);
  }

  /**
   * Wait for all pending async cleanup operations to complete
   */
  async waitForCleanups(): Promise<void> {
    if (this.pendingCleanups.size > 0) {
      await Promise.allSettled(this.pendingCleanups);
    }
  }

  /**
   * Clear all items from the cache (sync version)
   * Note: If onEvict is async, cleanups will be scheduled but not awaited
   */
  clear(): void {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        const result = this.onEvict(key, entry.value);
        if (result instanceof Promise) {
          this.pendingCleanups.add(result);
          result.finally(() => this.pendingCleanups.delete(result));
        }
      }
    }
    this.cache.clear();
  }

  /**
   * Clear all items from the cache (async version)
   * Awaits all onEvict callbacks
   */
  async clearAsync(): Promise<void> {
    if (this.onEvict) {
      const cleanups: Promise<void>[] = [];
      for (const [key, entry] of this.cache) {
        const result = this.onEvict(key, entry.value);
        if (result instanceof Promise) {
          cleanups.push(result);
        }
      }
      await Promise.allSettled(cleanups);
    }
    this.cache.clear();
  }

  /**
   * Get the number of items in the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys in the cache
   */
  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  /**
   * Get all values in the cache (excluding expired)
   */
  *values(): IterableIterator<V> {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.delete(key);
        continue;
      }
      yield entry.value;
    }
  }

  /**
   * Get all entries in the cache (excluding expired)
   */
  *entries(): IterableIterator<[string, V]> {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.delete(key);
        continue;
      }
      yield [key, entry.value];
    }
  }

  /**
   * Remove expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; max: number; ttl: number } {
    return {
      size: this.cache.size,
      max: this.max,
      ttl: this.ttl,
    };
  }
}

// --- Bounded Map (Size-Limited) ---

/**
 * A Map that automatically evicts oldest entries when max size is reached
 *
 * @example
 * ```ts
 * const blobs = new BoundedMap<Uint8Array>(1000);
 * blobs.set("key", new Uint8Array([1, 2, 3]));
 * ```
 */
export class BoundedMap<V> {
  private map: Map<string, V>;
  private max: number;
  private onEvict?: (key: string, value: V) => void;

  constructor(max: number, onEvict?: (key: string, value: V) => void) {
    this.map = new Map();
    this.max = max;
    this.onEvict = onEvict;
  }

  get(key: string): V | undefined {
    return this.map.get(key);
  }

  set(key: string, value: V): this {
    // Delete existing if present
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    // Evict oldest if at capacity
    while (this.map.size >= this.max) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        const oldValue = this.map.get(oldestKey);
        if (oldValue !== undefined && this.onEvict) {
          this.onEvict(oldestKey, oldValue);
        }
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, value);
    return this;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    const value = this.map.get(key);
    if (value !== undefined && this.onEvict) {
      this.onEvict(key, value);
    }
    return this.map.delete(key);
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.map) {
        this.onEvict(key, value);
      }
    }
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  entries(): IterableIterator<[string, V]> {
    return this.map.entries();
  }

  forEach(callback: (value: V, key: string, map: BoundedMap<V>) => void): void {
    this.map.forEach((value, key) => callback(value, key, this));
  }
}

// --- Async Memoization ---

/**
 * Memoize an async function with cache
 *
 * @example
 * ```ts
 * const fetchUser = memoizeAsync(
 *   async (id: string) => await api.getUser(id),
 *   { max: 100, ttl: 60000 }
 * );
 *
 * const user = await fetchUser("user:1"); // Fetches from API
 * const cached = await fetchUser("user:1"); // Returns cached value
 * ```
 */
export function memoizeAsync<T>(
  fn: (key: string) => Promise<T>,
  options: LRUCacheOptions<T>
): (key: string) => Promise<T> {
  const cache = new LRUCache<T>(options);
  const pending = new Map<string, Promise<T>>();

  return async (key: string): Promise<T> => {
    // Return cached value if available
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Return pending promise if already fetching
    const pendingPromise = pending.get(key);
    if (pendingPromise) {
      return pendingPromise;
    }

    // Fetch and cache
    const promise = fn(key)
      .then((value) => {
        cache.set(key, value);
        pending.delete(key);
        return value;
      })
      .catch((error) => {
        pending.delete(key);
        throw error;
      });

    pending.set(key, promise);
    return promise;
  };
}
