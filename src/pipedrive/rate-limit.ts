import Bottleneck from "bottleneck";
import { type Config } from "../config.js";
import { log } from "../logging.js";

let generalLimiter: Bottleneck | null = null;
let searchLimiter: Bottleneck | null = null;

const RESERVOIR_WINDOW_MS = 2000;

/**
 * A limiter that starts at most `perWindow` jobs per window, with no
 * standing timer. Bottleneck's `reservoirRefreshInterval` runs a 250 ms
 * `setInterval` for the life of the limiter. In a Durable Object that stops
 * hibernation, so every MCP session whose client keeps a connection open
 * (such as a streamable HTTP GET stream) stays in memory and billed. Here the
 * reservoir is refilled by a one-off timer set only when it runs out, at
 * least one window after the previous refill.
 */
function createWindowedLimiter(
  perWindow: number,
  options: { maxConcurrent: number; minTime: number },
): Bottleneck {
  const limiter = new Bottleneck({ reservoir: perWindow, ...options });
  let windowStart = Date.now();
  let refill: ReturnType<typeof setTimeout> | null = null;

  limiter.on("depleted", () => {
    if (refill) return;
    const wait = Math.max(0, windowStart + RESERVOIR_WINDOW_MS - Date.now());
    refill = setTimeout(() => {
      refill = null;
      windowStart = Date.now();
      void limiter.updateSettings({ reservoir: perWindow });
    }, wait);
  });

  return limiter;
}

export function createRateLimiters(config: Config): {
  general: Bottleneck;
  search: Bottleneck;
} {
  generalLimiter = createWindowedLimiter(config.rateLimitGeneralPer2s, {
    maxConcurrent: 2,
    minTime: 100,
  });

  searchLimiter = createWindowedLimiter(config.rateLimitSearchPer2s, {
    maxConcurrent: 1,
    minTime: 200,
  });

  generalLimiter.on("depleted", () => {
    log.debug("General rate limiter depleted, queuing requests");
  });

  searchLimiter.on("depleted", () => {
    log.debug("Search rate limiter depleted, queuing requests");
  });

  return { general: generalLimiter, search: searchLimiter };
}

export function parseRateLimitHeaders(headers: Record<string, string>): {
  remaining: number | null;
  resetMs: number | null;
  retryAfterMs: number | null;
} {
  const remaining = headers["x-ratelimit-remaining"]
    ? parseInt(headers["x-ratelimit-remaining"], 10)
    : null;
  const reset = headers["x-ratelimit-reset"]
    ? parseInt(headers["x-ratelimit-reset"], 10) * 1000
    : null;
  const retryAfter = headers["retry-after"]
    ? parseInt(headers["retry-after"], 10) * 1000
    : null;

  return { remaining, resetMs: reset, retryAfterMs: retryAfter };
}
