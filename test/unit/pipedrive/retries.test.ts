import { describe, it, expect } from "vitest";
import { withRetry } from "../../../src/pipedrive/retries.js";
import { HttpClientError, type HttpResponse } from "../../../src/pipedrive/http-client.js";

type Method = HttpResponse["method"];

function respond(status: number, method: Method): HttpResponse {
  return { status, data: {}, headers: {}, durationMs: 1, method };
}

const fast = { delayMs: 1, label: "test" };

describe("withRetry and non-idempotent creates", () => {
  it("retries a GET that returns 503", async () => {
    let calls = 0;
    const res = await withRetry(async () => {
      calls++;
      return respond(calls < 3 ? 503 : 200, "GET");
    }, fast);
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("does not retry a POST that returns 503", async () => {
    let calls = 0;
    const res = await withRetry(async () => {
      calls++;
      return respond(503, "POST");
    }, fast);
    expect(res.status).toBe(503);
    expect(calls).toBe(1);
  });

  it("does not retry a POST after a network error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpClientError("network", 0, "socket hang up", 1, "POST");
      }, fast),
    ).rejects.toThrow("socket hang up");
    expect(calls).toBe(1);
  });

  it("still retries a POST that was rate limited (429)", async () => {
    let calls = 0;
    const res = await withRetry(async () => {
      calls++;
      return calls === 1 ? { ...respond(429, "POST"), headers: { "retry-after": "0" } } : respond(201, "POST");
    }, fast);
    expect(res.status).toBe(201);
    expect(calls).toBe(2);
  });

  it("retries a PATCH after a network error (updates are safe to repeat)", async () => {
    let calls = 0;
    const res = await withRetry(async () => {
      calls++;
      if (calls === 1) throw new HttpClientError("network", 0, "socket hang up", 1, "PATCH");
      return respond(200, "PATCH");
    }, fast);
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });
});
