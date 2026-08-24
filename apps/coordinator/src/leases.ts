import { Redis } from "ioredis";
import { env } from "./env.js";

/**
 * Redis mirrors the active lease with a TTL (spec §7) for fast checks and
 * later heartbeats/counters. Postgres remains the source of truth — the
 * expiry sweeper reclaims from lease_expires_at, never from Redis state.
 * Local dev without REDIS_URL degrades to an in-memory mirror.
 */
export interface LeaseStore {
  set(chunkId: string, nonce: string, ttlSeconds: number): Promise<void>;
  clear(chunkId: string): Promise<void>;
}

class RedisLeaseStore implements LeaseStore {
  constructor(private readonly redis: Redis) {}
  // Best-effort mirror: Postgres owns lease truth, so an unreachable Redis
  // must never fail a lease or a submission.
  async set(chunkId: string, nonce: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(`lease:${chunkId}`, nonce, "EX", ttlSeconds);
    } catch (err) {
      console.error("redis lease set failed:", (err as Error).message);
    }
  }
  async clear(chunkId: string): Promise<void> {
    try {
      await this.redis.del(`lease:${chunkId}`);
    } catch (err) {
      console.error("redis lease clear failed:", (err as Error).message);
    }
  }
}

class MemoryLeaseStore implements LeaseStore {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly values = new Map<string, string>();
  async set(chunkId: string, nonce: string, ttlSeconds: number): Promise<void> {
    clearTimeout(this.timers.get(chunkId));
    this.values.set(chunkId, nonce);
    this.timers.set(
      chunkId,
      setTimeout(() => this.values.delete(chunkId), ttlSeconds * 1000).unref()
    );
  }
  async clear(chunkId: string): Promise<void> {
    clearTimeout(this.timers.get(chunkId));
    this.values.delete(chunkId);
  }
}

export function createLeaseStore(): { store: LeaseStore; backend: string } {
  if (env.REDIS_URL) {
    const redis = new Redis(env.REDIS_URL, {
      family: 6, // Fly 6PN private network is IPv6-only
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    redis.on("error", (err) => console.error("redis error:", err.message));
    return { store: new RedisLeaseStore(redis), backend: "redis" };
  }
  return { store: new MemoryLeaseStore(), backend: "memory" };
}
