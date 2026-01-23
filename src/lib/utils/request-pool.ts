/**
 * Request Connection Pool
 *
 * Provides connection pooling and request deduplication for:
 * - Reducing connection overhead
 * - Preventing duplicate concurrent requests
 * - Managing concurrent request limits
 */

import { createLogger } from "./logger";

const logger = createLogger("request-pool");

export interface PoolOptions {
  maxConcurrent?: number;
  maxQueueSize?: number;
  requestTimeoutMs?: number;
}

interface PendingRequest<T> {
  key: string;
  promise: Promise<T>;
  resolvers: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  }>;
  startedAt: number;
}

export class RequestPool {
  private pending: Map<string, PendingRequest<unknown>> = new Map();
  private activeCount = 0;
  private maxConcurrent: number;
  private maxQueueSize: number;
  private requestTimeoutMs: number;
  private queue: Array<() => void> = [];

  constructor(options: PoolOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 10;
    this.maxQueueSize = options.maxQueueSize ?? 100;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120000;
  }

  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key) as PendingRequest<T> | undefined;
    if (existing) {
      logger.debug(`Deduplicating request: ${key}`);
      return new Promise<T>((resolve, reject) => {
        existing.resolvers.push({ resolve, reject });
      });
    }

    const resolvers: PendingRequest<T>["resolvers"] = [];
    const promise = this.execute(fn).then(
      (result) => {
        this.pending.delete(key);
        for (const { resolve } of resolvers) {
          resolve(result);
        }
        return result;
      },
      (error) => {
        this.pending.delete(key);
        for (const { reject } of resolvers) {
          reject(error);
        }
        throw error;
      }
    );

    const pendingRequest: PendingRequest<T> = {
      key,
      promise,
      resolvers,
      startedAt: Date.now(),
    };

    this.pending.set(key, pendingRequest as PendingRequest<unknown>);
    return promise;
  }

  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueueSize) {
        throw new Error("Request queue is full");
      }

      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.activeCount++;

    // Use AbortController pattern to properly clean up the timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Request timed out after ${this.requestTimeoutMs}ms`));
        }, this.requestTimeoutMs);
      });

      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      // Always clear the timeout to prevent timer leaks
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      this.activeCount--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  get stats() {
    return {
      activeCount: this.activeCount,
      pendingCount: this.pending.size,
      queueLength: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  clear(): void {
    for (const [key, pending] of this.pending) {
      for (const { reject } of pending.resolvers) {
        reject(new Error("Pool cleared"));
      }
      this.pending.delete(key);
    }
    this.queue = [];
  }
}

const defaultPool = new RequestPool();

export function dedupeRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return defaultPool.dedupe(key, fn);
}

export function getPoolStats() {
  return defaultPool.stats;
}
