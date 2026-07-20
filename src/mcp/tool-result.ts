import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ErrorCategory } from "../pipedrive/error-normalizer.js";

/**
 * Structured error metadata carried alongside the human-readable error text.
 *
 * CallToolResult's base schema is a loose object, so this extra top-level
 * field survives SDK validation. Downstream wrappers (e.g. the Cloudflare
 * worker's token-refresh interceptor) key off `category` instead of
 * string-matching the error text, which misclassified validation errors
 * that merely mentioned "token" (see PIPEDRIVE-MCP-9).
 */
export interface ErrorMeta {
  category: ErrorCategory;
  status?: number;
}

export type ToolResult = CallToolResult & { errorMeta?: ErrorMeta };

export function successResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorResult(message: string, errorMeta?: ErrorMeta): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    isError: true,
    ...(errorMeta ? { errorMeta } : {}),
  };
}

export function paginatedResult(data: {
  items: unknown[];
  next_page_token: string | null;
  approx_count: number | null;
  truncated: boolean;
  pagination_mode: string;
  message?: string;
}): ToolResult {
  const output: Record<string, unknown> = {
    items: data.items,
    next_page_token: data.next_page_token,
    truncated: data.truncated,
  };

  if (data.approx_count !== null) {
    output.approx_count = data.approx_count;
  }

  if (data.truncated && data.next_page_token) {
    const countStr = data.approx_count ? ` of ~${data.approx_count}` : "";
    output.message =
      data.message ??
      `Showing ${data.items.length}${countStr} results. Use next_page_token to fetch more.`;
  }

  return successResult(output);
}
