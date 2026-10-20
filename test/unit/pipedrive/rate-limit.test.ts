import { describe, it, expect, afterEach, vi } from "vitest";
import { createRateLimiters } from "../../../src/pipedrive/rate-limit.js";
import type { Config } from "../../../src/config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    rateLimitGeneralPer2s: 3,
    rateLimitSearchPer2s: 2,
    logLevel: "error",
    ...overrides,
  } as Config;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createRateLimiters", () => {
  it("leaves no timer running while idle", async () => {
    vi.useFakeTimers();
    createRateLimiters(makeConfig());
    // A standing timer stops a Durable Object hibernating, so an idle
    // session with a connected client stays billed.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds the per-window limit and refills after the window", async () => {
    const { general } = createRateLimiters(makeConfig({ rateLimitGeneralPer2s: 3 }));
    const started: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 4 }, () =>
        general.schedule(async () => {
          started.push(Date.now() - t0);
        }),
      ),
    );
    expect(started).toHaveLength(4);
    // The first three run inside the window; the fourth waits for the refill.
    expect(started[2]).toBeLessThan(1000);
    expect(started[3]).toBeGreaterThanOrEqual(1900);
  });

  it("clears the refill timer once the queue drains", async () => {
    const { search } = createRateLimiters(makeConfig({ rateLimitSearchPer2s: 1 }));
    await search.schedule(async () => {});
    await search.schedule(async () => {});
    await new Promise((r) => setTimeout(r, 2100));
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
});
