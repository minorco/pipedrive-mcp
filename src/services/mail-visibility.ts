import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";

export type MailEntity = "deal" | "person" | "organization";

const V2_PATHS: Record<MailEntity, string> = {
  deal: "/deals",
  person: "/persons",
  organization: "/organizations",
};

// Pipedrive's email_messages_count counts every message linked to the entity,
// but the mailMessages association endpoints only return messages the
// authenticated user is allowed to see (private emails synced by other users
// are excluded). Fetch the count so the gap can be reported instead of
// silently presenting a partial history as complete. Any failure returns null:
// the listing must never fail because the count lookup did.
export async function fetchEmailMessagesCount(entity: MailEntity, id: number): Promise<number | null> {
  try {
    const { apiV2, rateLimiters } = getContext();
    const response = await rateLimiters.general.schedule(() =>
      withRetry(
        () => apiV2.get<Record<string, unknown>>(`${V2_PATHS[entity]}/${id}`, { include_fields: "email_messages_count" }),
        { label: `email_messages_count ${entity} ${id}` },
      ),
    );
    if (response.status !== 200) return null;
    const count = (response.data.data as Record<string, unknown> | null)?.email_messages_count;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

export interface VisibilityMeta {
  reported_count: number | null;
  visible_count: number | null;
  note?: string;
}

export interface VisibilityInput {
  entity: MailEntity;
  reportedCount: number | null;
  start: number;
  itemsReturned: number;
  hasMore: boolean;
}

// visible_count is only knowable on the terminal page (no further pages). A
// page past the end of the collection (a stale or hand-built offset cursor)
// returns nothing and tells us nothing about the total, so it stays null too.
export function buildVisibilityMeta(input: VisibilityInput): VisibilityMeta {
  const pastTheEnd = input.itemsReturned === 0 && input.start > 0;
  const visible = input.hasMore || pastTheEnd ? null : input.start + input.itemsReturned;
  const meta: VisibilityMeta = { reported_count: input.reportedCount, visible_count: visible };
  if (visible !== null && input.reportedCount !== null && visible < input.reportedCount) {
    meta.note =
      `Pipedrive returned ${visible} of the ${input.reportedCount} messages counted on this ${input.entity}. ` +
      "The API only returns messages visible to the authenticated user; emails synced privately by other users " +
      "are counted in email_messages_count but never returned. Ask those users to share the thread " +
      "(pipedrive_mail_threads_update shared_flag) or authenticate as them.";
  }
  return meta;
}
