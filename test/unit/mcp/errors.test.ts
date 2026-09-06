import { describe, it, expect, vi, beforeEach } from "vitest";

const captureError = vi.fn();
const addBreadcrumb = vi.fn();
vi.mock("../../../src/sentry.js", () => ({
  captureError: (...args: unknown[]) => captureError(...args),
  addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
}));

import {
  apiErrorResult,
  validationErrorResult,
  guardErrorResult,
} from "../../../src/mcp/errors.js";
import { errorResult, successResult } from "../../../src/mcp/tool-result.js";
import { type NormalizedError } from "../../../src/pipedrive/error-normalizer.js";

function makeNormalized(overrides: Partial<NormalizedError> = {}): NormalizedError {
  return {
    category: "auth",
    status: 401,
    tool: "pipedrive_deals_list",
    endpoint: "GET /deals",
    pipedrive_error: "Unauthorized",
    retryable: false,
    guidance: "Authentication failed.",
    ...overrides,
  };
}

describe("errorMeta on tool results", () => {
  it("apiErrorResult attaches category and status from the normalized error", () => {
    const result = apiErrorResult(makeNormalized());
    expect(result.isError).toBe(true);
    expect(result.errorMeta).toEqual({ category: "auth", status: 401 });
  });

  it("apiErrorResult carries validation category for 400s", () => {
    const result = apiErrorResult(
      makeNormalized({ category: "validation", status: 400, pipedrive_error: "Validation failed" }),
    );
    expect(result.errorMeta).toEqual({ category: "validation", status: 400 });
  });

  it("validationErrorResult marks schema-layer rejections as validation", () => {
    const result = validationErrorResult("pipedrive_deals_list", "cursor: invalid page token");
    expect(result.isError).toBe(true);
    expect(result.errorMeta).toEqual({ category: "validation" });
    // Text is unchanged: clients still see the same message.
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "pipedrive_deals_list: validation error. cursor: invalid page token",
    });
  });

  it("guardErrorResult marks guard rejections as validation", () => {
    const result = guardErrorResult("blocked by guard");
    expect(result.errorMeta).toEqual({ category: "validation" });
  });

  it("plain errorResult carries no errorMeta by default", () => {
    const result = errorResult("something broke");
    expect(result.errorMeta).toBeUndefined();
  });

  it("successResult carries no errorMeta", () => {
    const result = successResult({ ok: true });
    expect(result.errorMeta).toBeUndefined();
  });
});

describe("Sentry capture policy", () => {
  beforeEach(() => {
    captureError.mockClear();
    addBreadcrumb.mockClear();
  });

  it("does not capture not_found errors, but leaves a breadcrumb", () => {
    const result = apiErrorResult(
      makeNormalized({ category: "not_found", status: 404, pipedrive_error: "Deal not found", endpoint: "GET /deals/16898" }),
    );
    expect(result.isError).toBe(true);
    expect(result.errorMeta).toEqual({ category: "not_found", status: 404 });
    expect(captureError).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb.mock.calls[0][0]).toMatchObject({ level: "info", message: "pipedrive_deals_list 404 GET /deals/16898" });
  });

  it("does not capture rate_limit errors", () => {
    apiErrorResult(makeNormalized({ category: "rate_limit", status: 429, retryable: true }));
    expect(captureError).not.toHaveBeenCalled();
  });

  it("captures forbidden errors at warning level", () => {
    apiErrorResult(makeNormalized({ category: "forbidden", status: 403 }));
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toMatchObject({ category: "forbidden", status: 403, level: "warning" });
  });

  it("captures plan errors at warning level", () => {
    apiErrorResult(makeNormalized({ category: "plan", status: 402 }));
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toMatchObject({ category: "plan", status: 402 });
  });
});
