import { type NormalizedError, formatErrorMessage } from "../pipedrive/error-normalizer.js";
import { errorResult, type ToolResult } from "./tool-result.js";
import { captureError, addBreadcrumb } from "../sentry.js";

// Handled outcomes that are not defects: rate limits are absorbed by the retry
// layer, and 404s are almost always agent-supplied IDs. Neither is worth a
// Sentry issue; 404s leave a breadcrumb so they still show as context on a
// later real error.
const UNCAPTURED_CATEGORIES = new Set<NormalizedError["category"]>(["rate_limit", "not_found"]);

export function apiErrorResult(err: NormalizedError): ToolResult {
  if (err.category === "not_found") {
    addBreadcrumb({
      category: "pipedrive",
      level: "info",
      message: `${err.tool} ${err.status} ${err.endpoint}`,
      data: { pipedrive_error: err.pipedrive_error },
    });
  }
  if (!UNCAPTURED_CATEGORIES.has(err.category)) {
    captureError(new Error(`Pipedrive ${err.status}: ${err.pipedrive_error}`), {
      tool: err.tool,
      endpoint: err.endpoint,
      category: err.category,
      status: err.status,
      level: err.status >= 500 ? "error" : "warning",
      extra: { guidance: err.guidance, retryable: err.retryable },
    });
  }
  return errorResult(formatErrorMessage(err), {
    category: err.category,
    status: err.status,
  });
}

export function validationErrorResult(tool: string, message: string): ToolResult {
  return errorResult(`${tool}: validation error. ${message}`, {
    category: "validation",
  });
}

export function guardErrorResult(message: string): ToolResult {
  return errorResult(message, { category: "validation" });
}
