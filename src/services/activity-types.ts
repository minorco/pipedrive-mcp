import { TtlCache } from "./cache.js";
import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { log } from "../logging.js";

export interface ActivityType {
  name: string;
  keyString: string;
}

// Single-key cache for the account's activity types (reuses the field cache TTL).
let typeCache: TtlCache<ActivityType[]> | null = null;
const CACHE_KEY = "activity_types";

function getCache(): TtlCache<ActivityType[]> {
  if (!typeCache) {
    const { config } = getContext();
    typeCache = new TtlCache<ActivityType[]>(config.fieldCacheTtlMs);
  }
  return typeCache;
}

export async function getActivityTypes(refreshCache = false): Promise<ActivityType[]> {
  const cache = getCache();

  if (!refreshCache) {
    const cached = cache.get(CACHE_KEY);
    if (cached) return cached;
  }

  const { apiV1, rateLimiters } = getContext();
  // Activity types live on v1 and return in a single call, no pagination.
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.list<Record<string, unknown>>("/activityTypes"), {
      label: "GET /activityTypes",
    }),
  );

  if (response.status !== 200) {
    const errMsg = response.data.error ?? `HTTP ${response.status}`;
    throw new Error(`Failed to fetch activity types from /activityTypes: ${errMsg}`);
  }

  const types: ActivityType[] = (response.data.data ?? [])
    .filter((t) => t.active_flag !== false && typeof t.key_string === "string")
    .map((t) => ({ name: String(t.name ?? ""), keyString: String(t.key_string) }));

  cache.set(CACHE_KEY, types);
  log.debug(`Cached ${types.length} activity types`);
  return types;
}

/**
 * Validate a user-supplied activity type against the account's configured types.
 * Accepts a key_string (case-insensitively) or an exact type name, and returns
 * the canonical key_string. Returns an error message listing valid keys when no
 * match is found, so the bad value never reaches the Pipedrive API.
 */
export async function resolveActivityType(
  type: string,
): Promise<{ keyString: string | null; error: string | null }> {
  const types = await getActivityTypes();
  const wanted = type.trim().toLowerCase();

  // Prefer an exact key_string match, then fall back to matching the display name.
  const byKey = types.find((t) => t.keyString.toLowerCase() === wanted);
  if (byKey) return { keyString: byKey.keyString, error: null };

  const byName = types.find((t) => t.name.toLowerCase() === wanted);
  if (byName) return { keyString: byName.keyString, error: null };

  const validKeys = types.map((t) => t.keyString).join(", ") || "none";
  return {
    keyString: null,
    error: `Invalid activity type "${type}". Valid types for this Pipedrive account: ${validKeys}.`,
  };
}

export function clearActivityTypeCache(): void {
  typeCache?.clear();
}
