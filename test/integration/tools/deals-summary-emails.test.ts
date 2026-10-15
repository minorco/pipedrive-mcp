import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestContext, callTool, BASE_URL } from "../../helpers/setup.js";

const fixturesV2 = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../fixtures/v2", name), "utf-8"));

beforeAll(async () => {
  await setupTestContext();
});

afterEach(() => {
  nock.cleanAll();
});

function mailItem(id: number, subject: string, time: string, extra: Record<string, unknown> = {}) {
  return {
    object: "mailMessage",
    timestamp: time,
    data: {
      id,
      mail_thread_id: id + 1000,
      subject,
      snippet: `Snippet   for\n${subject}`,
      message_time: time,
      draft_flag: 0,
      from: [{ id: 1, name: "Jane Smith", email_address: "jane.smith@example.com" }],
      to: [],
      ...extra,
    },
  };
}

// The deal fixture has no person/org links worth following for these tests.
function mockDeal(emailCount: number | undefined, captureQuery?: (q: Record<string, string>) => void) {
  const deal = { ...fixturesV2("deals-get.json").data, person_id: null, org_id: null };
  if (emailCount !== undefined) deal.email_messages_count = emailCount;
  nock(BASE_URL)
    .get(`/api/v2/deals/${deal.id}`)
    .query((q) => {
      captureQuery?.(q as Record<string, string>);
      return true;
    })
    .reply(200, { success: true, data: deal });
  return deal.id as number;
}

describe("pipedrive_deals_summary include_emails", () => {
  it("is off by default: no mail call and no emails key", async () => {
    let query: Record<string, string> = {};
    const dealId = mockDeal(undefined, (q) => (query = q));
    const mail = nock(BASE_URL).get(`/api/v1/deals/${dealId}/mailMessages`).query(true).reply(200, { success: true, data: [] });

    const { result, data } = await callTool("pipedrive_deals_summary", { deal_id: dealId });

    expect(result.isError).toBeFalsy();
    expect(query.include_fields).toBeUndefined();
    expect(mail.isDone()).toBe(false);
    expect((data as Record<string, unknown>).emails).toBeUndefined();
  });

  it("returns the count and the 3 most recent non-draft emails, newest first", async () => {
    let query: Record<string, string> = {};
    const dealId = mockDeal(6, (q) => (query = q));
    let mailQuery: Record<string, string> = {};
    nock(BASE_URL)
      .get(`/api/v1/deals/${dealId}/mailMessages`)
      .query((q) => {
        mailQuery = q as Record<string, string>;
        return true;
      })
      .reply(200, {
        success: true,
        data: [
          mailItem(5, "", "2026-04-05 09:00:00", { draft_flag: 1 }),
          mailItem(1, "Oldest", "2026-04-01 09:00:00"),
          mailItem(4, "Newest", "2026-04-04 09:00:00"),
          mailItem(3, "Middle", "2026-04-03 09:00:00"),
          mailItem(2, "Second oldest", "2026-04-02 09:00:00"),
        ],
        additional_data: { pagination: { start: 0, limit: 10, more_items_in_collection: false } },
      });

    const { result, data } = await callTool("pipedrive_deals_summary", { deal_id: dealId, include_emails: true });

    expect(result.isError).toBeFalsy();
    expect(query.include_fields).toBe("email_messages_count");
    expect(mailQuery.include_body).toBe("0");
    const emails = (data as Record<string, unknown>).emails as Record<string, unknown>;
    expect(emails.reported_count).toBe(6);
    expect(emails.visible_count).toBe(5);
    const recent = emails.recent as Array<Record<string, unknown>>;
    expect(recent.map((m) => m.subject)).toEqual(["Newest", "Middle", "Second oldest"]);
    expect(recent[0]).toEqual({
      id: 4,
      mail_thread_id: 1004,
      subject: "Newest",
      from_name: "Jane Smith",
      from_email: "jane.smith@example.com",
      message_time: "2026-04-04 09:00:00",
      snippet: "Snippet for Newest",
    });
    expect(String(emails.note)).toContain("5 of 6 emails");
  });

  it("skips the mail call when Pipedrive counts no emails", async () => {
    const dealId = mockDeal(0);
    const mail = nock(BASE_URL).get(`/api/v1/deals/${dealId}/mailMessages`).query(true).reply(200, { success: true, data: [] });

    const { data } = await callTool("pipedrive_deals_summary", { deal_id: dealId, include_emails: true });

    expect(mail.isDone()).toBe(false);
    expect((data as Record<string, unknown>).emails).toEqual({ reported_count: 0, visible_count: 0, recent: [] });
  });

  it("degrades to a note when the mail call is refused, keeping the rest of the summary", async () => {
    const dealId = mockDeal(2);
    nock(BASE_URL)
      .get(`/api/v1/deals/${dealId}/mailMessages`)
      .query(true)
      .reply(403, { success: false, error: "Scope and URL mismatch" });

    const { result, data } = await callTool("pipedrive_deals_summary", { deal_id: dealId, include_emails: true });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect((parsed.deal as Record<string, unknown>).id).toBe(dealId);
    const emails = parsed.emails as Record<string, unknown>;
    expect(emails.reported_count).toBe(2);
    expect(emails.recent).toEqual([]);
    expect(String(emails.note)).toContain("HTTP 403");
  });

  it("leaves visible_count null when more messages exist than were read", async () => {
    const dealId = mockDeal(40);
    nock(BASE_URL)
      .get(`/api/v1/deals/${dealId}/mailMessages`)
      .query(true)
      .reply(200, {
        success: true,
        data: [mailItem(9, "Latest", "2026-04-09 09:00:00")],
        additional_data: { pagination: { start: 0, limit: 10, more_items_in_collection: true } },
      });

    const { data } = await callTool("pipedrive_deals_summary", { deal_id: dealId, include_emails: true });

    const emails = (data as Record<string, unknown>).emails as Record<string, unknown>;
    expect(emails.visible_count).toBeNull();
    expect((emails.recent as unknown[]).length).toBe(1);
  });
});
