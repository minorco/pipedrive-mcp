import { log } from "../logging.js";
import { parseRateLimitHeaders } from "./rate-limit.js";
import { HttpClientError, type HttpResponse } from "./http-client.js";

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  factor?: number;
  label?: string;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  attempts: 3,
  delayMs: 1000,
  factor: 2,
  label: "request",
};

// Creates (POST) are not idempotent: after a network error, timeout or 5xx,
// Pipedrive may already have written the record, so a blind retry could
// create it twice. Only a 429 is retried for them, because Pipedrive rejects
// rate-limited requests before processing them.
function isNonIdempotent(method: string | undefined): boolean {
  return method === "POST";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function withRetry<T>(
  fn: () => Promise<HttpResponse<T>>,
  opts?: RetryOptions,
): Promise<HttpResponse<T>> {
  const { attempts, delayMs, factor, label } = { ...DEFAULT_OPTIONS, ...opts };
  let lastError: Error | null = null;
  let currentDelay = delayMs;
  let consecutive429s = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fn();

      if (!isRetryableStatus(response.status)) {
        return response;
      }

      // Handle 429 specifically
      if (response.status === 429) {
        consecutive429s++;
        if (consecutive429s >= 3) {
          log.warn(`${label}: 3 consecutive 429s, failing fast`, { attempt });
          return response;
        }

        const { retryAfterMs } = parseRateLimitHeaders(response.headers);
        const waitMs = retryAfterMs ?? currentDelay;
        const jitter = Math.random() * 500;

        if (attempt < attempts) {
          log.warn(`${label}: 429 rate limited, waiting ${waitMs + jitter}ms`, { attempt });
          await sleep(waitMs + jitter);
          currentDelay = Math.round(currentDelay * factor);
          continue;
        }
        return response;
      }

      // Other retryable status
      consecutive429s = 0;
      if (isNonIdempotent(response.method)) {
        return response;
      }
      if (attempt < attempts) {
        log.warn(`${label}: status ${response.status}, retrying in ${currentDelay}ms`, { attempt });
        await sleep(currentDelay);
        currentDelay = Math.round(currentDelay * factor);
        continue;
      }
      return response;
    } catch (err) {
      consecutive429s = 0;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof HttpClientError && isNonIdempotent(err.method)) {
        throw err;
      }

      if (attempt < attempts) {
        log.warn(`${label}: ${lastError.message}, retrying in ${currentDelay}ms`, { attempt });
        await sleep(currentDelay);
        currentDelay = Math.round(currentDelay * factor);
        continue;
      }
    }
  }

  throw lastError ?? new Error(`${label}: all ${attempts} attempts failed`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
