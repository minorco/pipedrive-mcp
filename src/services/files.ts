import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { type HttpResponse } from "../pipedrive/http-client.js";
import { type V1ListResponse } from "../pipedrive/api-v1.js";
import {
  buildPaginationParams,
  buildPaginatedResult,
  extractNextPageToken,
  encodePageToken,
  decodePageToken,
  type PaginatedResult,
} from "../pipedrive/pagination.js";

type RawFile = Record<string, unknown>;

export interface FilesScopeInput {
  deal_id?: number;
  person_id?: number;
  org_id?: number;
  product_id?: number;
}

export interface FilesEndpoint {
  path: string;
  endpointLabel: string;
  scoped: boolean;
}

// GET /files ignores deal_id/person_id/... query params, so a scoped listing must
// hit the entity's own files sub-resource. Unscoped falls back to the account-wide
// endpoint (recent files across the whole account).
export function resolveFilesEndpoint(input: FilesScopeInput): FilesEndpoint {
  if (input.deal_id !== undefined) {
    return { path: `/deals/${input.deal_id}/files`, endpointLabel: `GET /deals/${input.deal_id}/files`, scoped: true };
  }
  if (input.person_id !== undefined) {
    return { path: `/persons/${input.person_id}/files`, endpointLabel: `GET /persons/${input.person_id}/files`, scoped: true };
  }
  if (input.org_id !== undefined) {
    return { path: `/organizations/${input.org_id}/files`, endpointLabel: `GET /organizations/${input.org_id}/files`, scoped: true };
  }
  if (input.product_id !== undefined) {
    return { path: `/products/${input.product_id}/files`, endpointLabel: `GET /products/${input.product_id}/files`, scoped: true };
  }
  return { path: "/files", endpointLabel: "GET /files", scoped: false };
}

export type FilePredicate = (file: RawFile) => boolean;

export interface FileFilterInput {
  activity_id?: number;
  lead_id?: string;
  mail_message_id?: number;
  include_inline?: boolean;
}

// Client-side filters applied within a scoped listing. Returns undefined when no
// filter is requested so the caller can take the single-request path.
export function buildFilePredicate(input: FileFilterInput): FilePredicate | undefined {
  const checks: FilePredicate[] = [];
  if (input.activity_id !== undefined) {
    const id = input.activity_id;
    checks.push((f) => Number(f.activity_id) === id);
  }
  if (input.lead_id !== undefined) {
    const id = input.lead_id;
    checks.push((f) => f.lead_id != null && String(f.lead_id) === id);
  }
  if (input.mail_message_id !== undefined) {
    const id = input.mail_message_id;
    checks.push((f) => Number(f.mail_message_id) === id);
    // Inline attachments are almost always signature images and tracking
    // pixels; hide them unless explicitly requested.
    if (!input.include_inline) checks.push((f) => !f.inline_flag);
  }
  if (checks.length === 0) return undefined;
  return (f) => checks.every((check) => check(f));
}

export interface ScanInfo {
  pages_scanned: number;
  scan_truncated: boolean;
}

export interface ListFilesOptions {
  path: string;
  label: string;
  limit: number;
  cursor?: string;
  sort?: string;
  predicate?: FilePredicate;
  maxScanPages?: number;
}

export type ListFilesOutcome =
  | { ok: true; result: PaginatedResult<RawFile>; scan?: ScanInfo }
  | { ok: false; response: HttpResponse<V1ListResponse<RawFile>> };

const DEFAULT_MAX_SCAN_PAGES = 5;

// Without a predicate this is a single page request. With a predicate it walks
// the underlying listing in pages of config.maxLimit, applying the filter, until
// at least `limit` matches are collected, the collection is exhausted, or
// maxScanPages is reached. next_page_token is always the underlying endpoint's
// next offset, so tokens stay opaque and resumable either way.
export async function listFiles(opts: ListFilesOptions): Promise<ListFilesOutcome> {
  const { apiV1, rateLimiters, config } = getContext();
  const sortParams = opts.sort ? { sort: opts.sort } : {};

  const fetchPage = (params: Record<string, string | number | boolean | undefined>) =>
    rateLimiters.general.schedule(() =>
      withRetry(() => apiV1.list<RawFile>(opts.path, params), { label: opts.label }),
    );

  if (!opts.predicate) {
    const params = { ...buildPaginationParams("offset", opts.limit, opts.cursor), ...sortParams };
    const response = await fetchPage(params);
    if (response.status !== 200) return { ok: false, response };
    const items = response.data.data ?? [];
    return { ok: true, result: buildPaginatedResult(items, "offset", response.data as unknown as Record<string, unknown>) };
  }

  const maxScanPages = opts.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES;
  const pageSize = config.maxLimit;
  let nextStart: number | null = Number(buildPaginationParams("offset", pageSize, opts.cursor).start);
  const matched: RawFile[] = [];
  let pagesScanned = 0;

  while (nextStart !== null && pagesScanned < maxScanPages && matched.length < opts.limit) {
    const response = await fetchPage({ start: nextStart, limit: pageSize, ...sortParams });
    if (response.status !== 200) return { ok: false, response };
    pagesScanned++;
    for (const file of response.data.data ?? []) {
      if (opts.predicate(file)) matched.push(file);
    }
    const token = extractNextPageToken("offset", response.data as unknown as Record<string, unknown>);
    nextStart = token ? parseInt(decodePageToken(token).value, 10) : null;
  }

  const nextToken = nextStart !== null ? encodePageToken("offset", nextStart) : null;
  return {
    ok: true,
    result: {
      items: matched,
      next_page_token: nextToken,
      approx_count: null,
      truncated: nextToken !== null,
      pagination_mode: "offset",
    },
    scan: { pages_scanned: pagesScanned, scan_truncated: nextToken !== null && matched.length < opts.limit },
  };
}
