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

// ---- Attachments of one mail message ----
//
// Pipedrive stores email attachments as files with only mail_message_id set:
// they are NOT linked to the deal/person/org the email belongs to (a deal with
// attachment-bearing emails reports files_count 0), and GET /files has no
// filter. What we do have: GET /files is ordered by id, ids rise with add_time,
// and attachment files are created within seconds of the message's add_time.
// So: read the message's add_time, binary-search the listing to that moment,
// then scan the neighbouring pages for files carrying that mail_message_id.
// Roughly 2*log2(N) single-item probes plus a few pages (~35 cheap requests on
// an account with 100k files).

export interface MailMessageFilesLookup {
  probes: number;
  pages_scanned: number;
  window_start: number;
}

export type MailMessageFilesOutcome =
  | { ok: true; items: RawFile[]; lookup: MailMessageFilesLookup }
  | { ok: false; response: HttpResponse<Record<string, unknown>>; endpoint: string };

// Pipedrive emits both "2019-05-14T19:30:24.000Z" and "2019-05-14 19:30:27" (UTC).
export function parsePipedriveTime(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  let normalised = value.trim().replace(" ", "T");
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(normalised)) normalised += "Z";
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? ms : null;
}

const LOOKUP_TOLERANCE_BEFORE_MS = 5 * 60 * 1000; // search target = message time minus this
const LOOKUP_MAX_PAGES = 5;
const LOOKUP_STOP_AFTER_MS = 60 * 60 * 1000; // attachments sync within seconds; stop once files are an hour past the message
const LOOKUP_MAX_OFFSET = 1 << 24;

export interface FindMailMessageFilesOptions {
  messageId: number;
  includeInline: boolean;
  label: string;
}

export async function findMailMessageFiles(opts: FindMailMessageFilesOptions): Promise<MailMessageFilesOutcome> {
  const { apiV1, rateLimiters, config } = getContext();
  const schedule = <T>(fn: () => Promise<HttpResponse<T>>): Promise<HttpResponse<T>> =>
    rateLimiters.general.schedule(() => withRetry(fn, { label: opts.label }));

  const messageEndpoint = `/mailbox/mailMessages/${opts.messageId}`;
  const messageResponse = await schedule(() => apiV1.get<Record<string, unknown>>(messageEndpoint));
  if (messageResponse.status !== 200) {
    return { ok: false, response: messageResponse as unknown as HttpResponse<Record<string, unknown>>, endpoint: `GET ${messageEndpoint}` };
  }
  const message = (messageResponse.data.data ?? {}) as Record<string, unknown>;
  const messageTime = parsePipedriveTime(message.add_time) ?? parsePipedriveTime(message.message_time);
  const target = messageTime !== null ? messageTime - LOOKUP_TOLERANCE_BEFORE_MS : null;

  let probes = 0;
  const pageAt = async (start: number, limit: number): Promise<{ items: RawFile[]; response: HttpResponse<V1ListResponse<RawFile>> }> => {
    probes++;
    const response = await schedule(() => apiV1.list<RawFile>("/files", { start, limit }));
    return { items: response.status === 200 ? (response.data.data ?? []) : [], response };
  };
  const timeAt = (file: RawFile | undefined): number | null => (file ? parsePipedriveTime(file.add_time) : null);

  // Locate the first offset whose file was added at or after the target time.
  let windowStart = 0;
  if (target !== null) {
    // Exponential probe for an upper bound, then binary search down to a page.
    let lo = 0;
    let hi = 1024;
    for (;;) {
      const { items, response } = await pageAt(hi, 1);
      if (response.status !== 200) return { ok: false, response: response as unknown as HttpResponse<Record<string, unknown>>, endpoint: "GET /files" };
      const t = timeAt(items[0]);
      if (items.length === 0 || (t !== null && t >= target)) break;
      lo = hi;
      hi *= 2;
      if (hi > LOOKUP_MAX_OFFSET) break;
    }
    while (hi - lo > config.maxLimit) {
      const mid = lo + Math.floor((hi - lo) / 2);
      const { items, response } = await pageAt(mid, 1);
      if (response.status !== 200) return { ok: false, response: response as unknown as HttpResponse<Record<string, unknown>>, endpoint: "GET /files" };
      const t = timeAt(items[0]);
      if (items.length === 0 || (t !== null && t >= target)) hi = mid;
      else lo = mid;
    }
    windowStart = lo;
  }

  // Scan forward from the window for the message's files.
  const matched: RawFile[] = [];
  let pagesScanned = 0;
  let start = windowStart;
  while (pagesScanned < LOOKUP_MAX_PAGES) {
    const { items, response } = await pageAt(start, config.maxLimit);
    if (response.status !== 200) return { ok: false, response: response as unknown as HttpResponse<Record<string, unknown>>, endpoint: "GET /files" };
    pagesScanned++;
    for (const file of items) {
      if (Number(file.mail_message_id) !== opts.messageId) continue;
      if (!opts.includeInline && file.inline_flag) continue;
      matched.push(file);
    }
    if (items.length < config.maxLimit) break;
    const last = timeAt(items[items.length - 1]);
    if (messageTime !== null && last !== null && last > messageTime + LOOKUP_STOP_AFTER_MS) break;
    start += items.length;
  }

  return { ok: true, items: matched, lookup: { probes, pages_scanned: pagesScanned, window_start: windowStart } };
}
