import { type DealSummary, type DealSummaryEmails } from "../services/summaries.js";
import { compactDeal, compactPerson, compactOrganization, compactActivity, compactNote } from "./entities.js";

export interface FormattedDealSummary {
  deal: ReturnType<typeof compactDeal>;
  person?: ReturnType<typeof compactPerson> | null;
  organization?: ReturnType<typeof compactOrganization> | null;
  recent_activities?: ReturnType<typeof compactActivity>[];
  recent_notes?: Array<{ id: number; content_preview: string; update_time: string | null }>;
  products?: Array<{ id: number; name: string; quantity: number; price: number }>;
  emails?: FormattedDealEmails;
}

export interface FormattedDealEmails {
  reported_count: number | null;
  visible_count: number | null;
  recent: Array<{
    id: number;
    mail_thread_id: number | null;
    subject: string;
    from_name: string | null;
    from_email: string;
    message_time: string | null;
    snippet: string;
  }>;
  note?: string;
}

export function formatDealSummary(summary: DealSummary): FormattedDealSummary {
  const result: FormattedDealSummary = {
    deal: compactDeal(summary.deal),
  };

  if (summary.person) {
    result.person = compactPerson(summary.person);
  }

  if (summary.organization) {
    result.organization = compactOrganization(summary.organization);
  }

  if (summary.activities) {
    result.recent_activities = summary.activities.map(compactActivity);
  }

  if (summary.notes) {
    result.recent_notes = summary.notes.map((n) => ({
      id: n.id as number,
      content_preview: truncate((n.content as string) ?? "", 200),
      update_time: (n.update_time as string) ?? null,
    }));
  }

  if (summary.products) {
    result.products = summary.products.map((p) => ({
      id: (p.id ?? p.product_id) as number,
      name: (p.name ?? (p.product as Record<string, unknown>)?.name ?? "") as string,
      quantity: (p.quantity as number) ?? 0,
      price: (p.item_price as number) ?? 0,
    }));
  }

  if (summary.emails) {
    result.emails = formatDealEmails(summary.emails);
  }

  return result;
}

function formatDealEmails(emails: DealSummaryEmails): FormattedDealEmails {
  const formatted: FormattedDealEmails = {
    reported_count: emails.reported_count,
    visible_count: emails.visible_count,
    recent: emails.recent.map((m) => {
      const from = Array.isArray(m.from) && m.from.length > 0 ? (m.from[0] as Record<string, unknown>) : null;
      return {
        id: m.id as number,
        mail_thread_id: (m.mail_thread_id as number) ?? null,
        subject: (m.subject as string) ?? "",
        from_name: from ? ((from.name as string) ?? null) : null,
        from_email: from ? ((from.email_address as string) ?? "") : "",
        message_time: (m.message_time as string) ?? null,
        snippet: truncate(((m.snippet as string) ?? "").replace(/\s+/g, " ").trim(), 160),
      };
    }),
  };

  if (emails.unavailable) {
    formatted.note = `Emails unavailable: ${emails.unavailable}.`;
  } else if (
    emails.visible_count !== null &&
    emails.reported_count !== null &&
    emails.visible_count < emails.reported_count
  ) {
    formatted.note =
      `${emails.visible_count} of ${emails.reported_count} emails on this deal are visible to the authenticated user; ` +
      "the rest were synced privately by other users.";
  }
  if (formatted.recent.length > 0) {
    formatted.note = [formatted.note, "Use pipedrive_deal_mail_messages_list or pipedrive_mail_messages_get for full emails."]
      .filter(Boolean)
      .join(" ");
  }
  return formatted;
}

export interface FormattedPipelineSummary {
  pipelines: Array<{ id: number; name: string; active: boolean }>;
  stages: Array<{ id: number; name: string; pipeline_id: number; order_nr: number; deal_count: number }>;
}

export function formatPipelineSummary(data: {
  pipelines: Record<string, unknown>[];
  stages: Record<string, unknown>[];
  deal_counts: Record<string, number>;
}): FormattedPipelineSummary {
  return {
    pipelines: data.pipelines.map((p) => ({
      id: p.id as number,
      name: (p.name as string) ?? "",
      active: (p.active as boolean) ?? true,
    })),
    stages: data.stages.map((s) => ({
      id: s.id as number,
      name: (s.name as string) ?? "",
      pipeline_id: s.pipeline_id as number,
      order_nr: (s.order_nr as number) ?? 0,
      deal_count: data.deal_counts[String(s.id)] ?? 0,
    })),
  };
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + "...";
}
