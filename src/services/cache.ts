import { getContext } from "../server.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    // Prune expired entries first
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    return this.store.size;
  }
}

/**
 * Scope a cache key to the Pipedrive account behind the current context.
 * Every module-level cache in src/services must use one of these helpers so a
 * process that hosts several accounts (or several users) never serves one
 * account's metadata to another.
 */
export function accountCacheKey(key: string): string {
  const { config } = getContext();
  return `${config.cacheScope ?? config.companyDomain}|${key}`;
}

/**
 * Scope a cache key to the authenticated user, not just the account. Use for
 * anything derived from /users/me. The credential doubles as the identity: an
 * OAuth token belongs to exactly one user and an API token to exactly one user.
 */
export function userCacheKey(key: string): string {
  const { config } = getContext();
  const credential = config.oauthToken ?? config.apiToken ?? "";
  return `${accountCacheKey(key)}|${credential}`;
}
