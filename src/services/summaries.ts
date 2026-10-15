import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { type HttpResponse } from "../pipedrive/http-client.js";

export interface DealSummary {
  deal: Record<string, unknown>;
  activities?: Record<string, unknown>[];
  notes?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
  person?: Record<string, unknown> | null;
  organization?: Record<string, unknown> | null;
  emails?: DealSummaryEmails;
}

/**
 * Email digest for a deal summary. `reported_count` is Pipedrive's
 * email_messages_count (every linked message); `recent` only holds messages the
 * authenticated user can see, so it can be shorter than the count suggests.
 * `unavailable` is set when the mail lookup failed (e.g. the connection has no
 * mail scope) so the rest of the summary still returns.
 */
export interface DealSummaryEmails {
  reported_count: number | null;
  visible_count: number | null;
  recent: Record<string, unknown>[];
  unavailable?: string;
}

// How many messages to read when picking the most recent. Pipedrive returns
// deal mail newest first; reading a few more than we keep lets drafts be
// skipped and guards the client-side sort without paging.
const EMAIL_FETCH_LIMIT = 10;
export const RECENT_EMAILS_KEPT = 3;

export interface DealSummaryOptions {
  dealId: number;
  includeRecentActivities?: boolean;
  includeNotes?: boolean;
  includeProducts?: boolean;
  includeEmails?: boolean;
}

/** The deal fetch failed (404 for an unknown id, 403, 5xx); carries the raw response for error normalisation. */
export interface DealSummaryFailure {
  error: HttpResponse<unknown>;
  endpoint: string;
}

export function isDealSummaryFailure(value: DealSummary | DealSummaryFailure): value is DealSummaryFailure {
  return "error" in value;
}

export async function buildDealSummary(opts: DealSummaryOptions): Promise<DealSummary | DealSummaryFailure> {
  const { apiV2, apiV1, rateLimiters } = getContext();

  // Fetch the deal. A non-200 (typically 404 for an id the agent guessed) must
  // surface as a normal API error, not a TypeError from reading the missing body
  // (Sentry PIPEDRIVE-MCP-K).
  const dealResponse = await rateLimiters.general.schedule(() =>
    withRetry(
      () =>
        apiV2.get<Record<string, unknown>>(
          `/deals/${opts.dealId}`,
          // The email count rides on the deal fetch, so it costs no extra call.
          opts.includeEmails ? { include_fields: "email_messages_count" } : undefined,
        ),
      { label: `GET deal ${opts.dealId}` },
    ),
  );
  const deal =dealResponse.data?.data;
  if (dealResponse.status !== 200 || !deal) {
    return { error: dealResponse, endpoint: `GET /deals/${opts.dealId}` };
  }
  const summary: DealSummary = { deal };

  // Parallel fetches for related data
  const promises: Promise<void>[] = [];

  if (opts.includeRecentActivities) {
    promises.push(
      rateLimiters.general
        .schedule(() =>
          withRetry(
            () =>
              apiV2.list<Record<string, unknown>>("/activities", {
                deal_id: opts.dealId,
                limit: 10,
                sort_by: "due_date",
                sort_direction: "desc",
              }),
            { label: `GET activities for deal ${opts.dealId}` },
          ),
        )
        .then((r) => {
          summary.activities = r.data.data ?? [];
        }),
    );
  }

  if (opts.includeNotes) {
    promises.push(
      rateLimiters.general
        .schedule(() =>
          withRetry(
            () =>
              apiV1.list<Record<string, unknown>>("/notes", {
                deal_id: opts.dealId,
                limit: 10,
                sort: "update_time DESC",
              }),
            { label: `GET notes for deal ${opts.dealId}` },
          ),
        )
        .then((r) => {
          summary.notes = r.data.data ?? [];
        }),
    );
  }

  if (opts.includeProducts) {
    promises.push(
      rateLimiters.general
        .schedule(() =>
          withRetry(
            () =>
              apiV2.list<Record<string, unknown>>(`/deals/${opts.dealId}/products`, {
                limit: 50,
              }),
            { label: `GET products for deal ${opts.dealId}` },
          ),
        )
        .then((r) => {
          summary.products = r.data.data ?? [];
        }),
    );
  }

  if (opts.includeEmails) {
    promises.push(fetchRecentDealEmails(opts.dealId, deal).then((emails) => {
      summary.emails = emails;
    }));
  }

  // Fetch linked person/org
  const personId = deal.person_id as number | undefined;
  const orgId = deal.org_id as number | undefined;

  if (personId) {
    promises.push(
      rateLimiters.general
        .schedule(() =>
          withRetry(() => apiV2.get<Record<string, unknown>>(`/persons/${personId}`), {
            label: `GET person ${personId}`,
          }),
        )
        .then((r) => {
          summary.person = r.data.data;
        }),
    );
  }

  if (orgId) {
    promises.push(
      rateLimiters.general
        .schedule(() =>
          withRetry(() => apiV2.get<Record<string, unknown>>(`/organizations/${orgId}`), {
            label: `GET org ${orgId}`,
          }),
        )
        .then((r) => {
          summary.organization = r.data.data;
        }),
    );
  }

  await Promise.all(promises);
  return summary;
}

function messageTime(message: Record<string, unknown>): number {
  const raw = message.message_time ?? message.add_time;
  if (typeof raw !== "string") return 0;
  const ms = Date.parse(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

// Never throws: a mail failure degrades to `unavailable` rather than failing
// the whole summary.
async function fetchRecentDealEmails(dealId: number, deal: Record<string, unknown>): Promise<DealSummaryEmails> {
  const count = deal.email_messages_count;
  const reportedCount = typeof count === "number" ? count : null;
  if (reportedCount === 0) return { reported_count: 0, visible_count: 0, recent: [] };

  try {
    const { apiV1, rateLimiters } = getContext();
    const response = await rateLimiters.general.schedule(() =>
      withRetry(
        () =>
          apiV1.list<Record<string, unknown>>(`/deals/${dealId}/mailMessages`, {
            start: 0,
            limit: EMAIL_FETCH_LIMIT,
            include_body: 0,
          }),
        { label: `GET mail messages for deal ${dealId}` },
      ),
    );
    if (response.status !== 200) {
      return {
        reported_count: reportedCount,
        visible_count: null,
        recent: [],
        unavailable: `Pipedrive returned HTTP ${response.status} for the deal's mail messages`,
      };
    }

    const items = (response.data.data ?? []).map((item) => {
      // Associated-mail endpoints wrap each message: { object, timestamp, data }
      const inner = item.data;
      return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : item;
    });
    const pagination = (response.data.additional_data as Record<string, unknown> | undefined)?.pagination as
      | Record<string, unknown>
      | undefined;
    const hasMore = Boolean(pagination?.more_items_in_collection);

    const recent = items
      .filter((m) => !m.draft_flag)
      .sort((a, b) => messageTime(b) - messageTime(a))
      .slice(0, RECENT_EMAILS_KEPT);

    return { reported_count: reportedCount, visible_count: hasMore ? null : items.length, recent };
  } catch (err) {
    return {
      reported_count: reportedCount,
      visible_count: null,
      recent: [],
      unavailable: `Mail lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface PipelineSummaryOptions {
  pipelineId?: number;
  ownerId?: number;
  status?: string;
}

export async function buildPipelineSummary(opts: PipelineSummaryOptions): Promise<{
  pipelines: Record<string, unknown>[];
  stages: Record<string, unknown>[];
  deal_counts: Record<string, number>;
}> {
  const { apiV2, rateLimiters } = getContext();

  // Fetch pipelines
  const pipelinesResponse = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>("/pipelines", { limit: 100 }), {
      label: "GET pipelines",
    }),
  );

  let pipelines = pipelinesResponse.data.data ?? [];
  if (opts.pipelineId) {
    pipelines = pipelines.filter((p) => (p.id as number) === opts.pipelineId);
  }

  // Fetch stages
  const stagesResponse = await rateLimiters.general.schedule(() =>
    withRetry(
      () =>
        apiV2.list<Record<string, unknown>>("/stages", {
          limit: 100,
          ...(opts.pipelineId ? { pipeline_id: opts.pipelineId } : {}),
        }),
      { label: "GET stages" },
    ),
  );

  const stages = stagesResponse.data.data ?? [];

  // Count deals per stage
  const dealCounts: Record<string, number> = {};
  for (const stage of stages) {
    const stageId = stage.id as number;
    const params: Record<string, string | number | boolean | undefined> = {
      stage_id: stageId,
      limit: 1, // Just need the count
      status: opts.status ?? "open",
    };
    if (opts.ownerId) params.owner_id = opts.ownerId;

    const dealsResponse = await rateLimiters.general.schedule(() =>
      withRetry(() => apiV2.list<Record<string, unknown>>("/deals", params), {
        label: `GET deals count for stage ${stageId}`,
      }),
    );

    const count =
      (dealsResponse.data.additional_data?.estimated_count as number) ??
      (dealsResponse.data.data?.length ?? 0);
    dealCounts[String(stageId)] = count;
  }

  return { pipelines, stages, deal_counts: dealCounts };
}
