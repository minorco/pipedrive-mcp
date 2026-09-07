import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestContext, callTool, BASE_URL } from "../../helpers/setup.js";

const fixturesV1 = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../fixtures/v1", name), "utf-8"));

beforeAll(async () => {
  await setupTestContext();
});

afterEach(() => {
  nock.cleanAll();
});

type Items = Array<Record<string, unknown>>;

describe("pipedrive_files_list scoping", () => {
  it("deal_id lists the deal's own files via /deals/{id}/files and never the account-wide endpoint", async () => {
    const accountWide = nock(BASE_URL).get("/api/v1/files").query(true).reply(200, fixturesV1("files-list.json"));
    const dealScope = nock(BASE_URL)
      .get("/api/v1/deals/117/files")
      .query((q) => q.start === "0" && q.limit === "25" && q.deal_id === undefined)
      .reply(200, fixturesV1("deal-files-list.json"));

    const { result, data } = await callTool("pipedrive_files_list", { deal_id: 117 });

    expect(result.isError).toBeFalsy();
    expect(dealScope.isDone()).toBe(true);
    expect(accountWide.isDone()).toBe(false);
    const parsed = data as Record<string, unknown>;
    const items = parsed.items as Items;
    expect(items.map((f) => f.id)).toEqual([9001, 9002, 9003]);
    expect(items[0].mail_message_id).toBe(800);
    expect(items[1].inline_flag).toBe(true);
    expect(items[2].activity_id).toBe(901);
    expect(items[0]).not.toHaveProperty("s3_bucket");
    expect(parsed.truncated).toBe(false);
  });

  it("person_id hits /persons/{id}/files", async () => {
    const scope = nock(BASE_URL).get("/api/v1/persons/201/files").query(true).reply(200, fixturesV1("person-files-list.json"));
    const { result, data } = await callTool("pipedrive_files_list", { person_id: 201 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    expect(((data as Record<string, unknown>).items as Items)[0].id).toBe(9010);
  });

  it("org_id hits /organizations/{id}/files", async () => {
    const scope = nock(BASE_URL).get("/api/v1/organizations/301/files").query(true).reply(200, fixturesV1("deal-files-list.json"));
    const { result } = await callTool("pipedrive_files_list", { org_id: 301 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("product_id hits /products/{id}/files", async () => {
    const scope = nock(BASE_URL).get("/api/v1/products/401/files").query(true).reply(200, fixturesV1("deal-files-list.json"));
    const { result } = await callTool("pipedrive_files_list", { product_id: 401 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("no scope lists account-wide files from /files", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v1/files")
      .query((q) => q.start === "0" && q.limit === "25")
      .reply(200, fixturesV1("files-list.json"));
    const { result, data } = await callTool("pipedrive_files_list", {});
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    expect(((data as Record<string, unknown>).items as Items).length).toBe(2);
  });

  it("forwards sort to the scoped endpoint", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v1/deals/117/files")
      .query((q) => q.sort === "update_time")
      .reply(200, fixturesV1("deal-files-list.json"));
    const { result } = await callTool("pipedrive_files_list", { deal_id: 117, sort: "update_time" });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("rejects two scopes at once before any API call", async () => {
    const { result } = await callTool("pipedrive_files_list", { deal_id: 117, person_id: 201 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(String((result.content[0] as { text: string }).text)).toContain("at most one");
    expect(nock.pendingMocks()).toEqual([]);
  });

  it("rejects activity_id or lead_id without a scope, explaining why", async () => {
    const byActivity = await callTool("pipedrive_files_list", { activity_id: 901 });
    expect(byActivity.result.isError).toBe(true);
    expect(String((byActivity.result.content[0] as { text: string }).text)).toContain("no per-activity or per-lead files endpoint");

    const byLead = await callTool("pipedrive_files_list", { lead_id: "adf21080-0e10-11eb-879b-46d8c6e15c39" });
    expect(byLead.result.isError).toBe(true);
  });

  it("applies activity_id as a filter within a deal scope", async () => {
    nock(BASE_URL).get("/api/v1/deals/117/files").query(true).reply(200, fixturesV1("deal-files-list.json"));
    const { result, data } = await callTool("pipedrive_files_list", { deal_id: 117, activity_id: 901 });
    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect((parsed.items as Items).map((f) => f.id)).toEqual([9003]);
    expect(parsed.scan).toEqual({ pages_scanned: 1, scan_truncated: false });
    expect(parsed.next_page_token).toBeNull();
  });

  it("emits a continuation token when the endpoint reports more items without next_start", async () => {
    const fixture = fixturesV1("deal-files-list.json");
    fixture.additional_data.pagination.more_items_in_collection = true;
    nock(BASE_URL).get("/api/v1/deals/117/files").query(true).reply(200, fixture);

    const { data } = await callTool("pipedrive_files_list", { deal_id: 117 });
    const parsed = data as Record<string, unknown>;
    expect(parsed.next_page_token).toBe("offset:25");
    expect(parsed.truncated).toBe(true);
  });

  it("surfaces Pipedrive errors with the scoped endpoint label", async () => {
    nock(BASE_URL).get("/api/v1/deals/999/files").query(true).reply(404, { success: false, error: "Deal not found" });
    const { result } = await callTool("pipedrive_files_list", { deal_id: 999 });
    expect(result.isError).toBe(true);
    expect(String((result.content[0] as { text: string }).text)).toContain("GET /deals/999/files");
    expect(result.errorMeta).toEqual({ category: "not_found", status: 404 });
  });
});

describe("pipedrive_files_list mail_message_id lookup", () => {
  // Synthetic id-ordered account listing: file i was added at BASE + i minutes.
  // Message 800 was synced at BASE + 1995 minutes; its files sit at 1996..1998.
  const BASE = Date.UTC(2026, 2, 20, 0, 0, 0);
  const TOTAL = 2500;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  const fileAt = (i: number) => ({
    id: 100000 + i,
    name: `file-${i}.pdf`,
    file_name: `file-${i}.pdf`,
    file_type: "pdf",
    file_size: 100,
    deal_id: null,
    person_id: null,
    org_id: null,
    mail_message_id: i === 1996 || i === 1997 ? 800 : i === 1998 ? 801 : null,
    inline_flag: i === 1997,
    add_time: fmt(BASE + i * 60_000),
    update_time: fmt(BASE + i * 60_000),
  });
  const mockListing = () =>
    nock(BASE_URL)
      .persist()
      .get("/api/v1/files")
      .query(true)
      .reply((uri) => {
        const u = new URL(uri, BASE_URL);
        const start = Number(u.searchParams.get("start") ?? 0);
        const limit = Number(u.searchParams.get("limit") ?? 25);
        const items = Array.from({ length: Math.max(0, Math.min(limit, TOTAL - start)) }, (_, k) => fileAt(start + k));
        return [200, { success: true, data: items, additional_data: { pagination: { start, limit, more_items_in_collection: start + items.length < TOTAL } } }];
      });
  const mockMessage = (addTime = fmt(BASE + 1995 * 60_000)) =>
    nock(BASE_URL).get("/api/v1/mailbox/mailMessages/800").query(true).reply(200, { success: true, data: { id: 800, add_time: addTime, has_attachments_flag: 1 } });

  it("locates a message's attachments in the account-wide listing without a scope", async () => {
    mockMessage();
    mockListing();
    const { result, data } = await callTool("pipedrive_files_list", { mail_message_id: 800 });
    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect((parsed.items as Items).map((f) => f.id)).toEqual([101996]);
    const lookup = parsed.lookup as Record<string, number>;
    expect(lookup.probes).toBeLessThan(40);
    expect(lookup.pages_scanned).toBeLessThanOrEqual(2);
    expect(lookup.window_start).toBeLessThanOrEqual(1996);
    expect(parsed.mail_message_id).toBe(800);
  });

  it("include_inline also returns inline attachments", async () => {
    mockMessage();
    mockListing();
    const { data } = await callTool("pipedrive_files_list", { mail_message_id: 800, include_inline: true });
    expect(((data as Record<string, unknown>).items as Items).map((f) => f.id)).toEqual([101996, 101997]);
  });

  it("handles ISO timestamps on the message and falls back to a full scan window when time is missing", async () => {
    nock(BASE_URL).get("/api/v1/mailbox/mailMessages/800").query(true).reply(200, { success: true, data: { id: 800, add_time: new Date(BASE + 1995 * 60_000).toISOString() } });
    mockListing();
    const { data } = await callTool("pipedrive_files_list", { mail_message_id: 800 });
    expect(((data as Record<string, unknown>).items as Items).map((f) => f.id)).toEqual([101996]);
  });

  it("reports an empty result with guidance when the message has no files", async () => {
    nock(BASE_URL).get("/api/v1/mailbox/mailMessages/800").query(true).reply(200, { success: true, data: { id: 800, add_time: fmt(BASE + 100 * 60_000) } });
    mockListing();
    const { result, data } = await callTool("pipedrive_files_list", { mail_message_id: 800 });
    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.items).toEqual([]);
    expect(String(parsed.message)).toContain("No attachment files");
  });

  it("surfaces a missing message as a not_found error", async () => {
    nock(BASE_URL).get("/api/v1/mailbox/mailMessages/800").query(true).reply(404, { success: false, error: "Mail message not found" });
    const { result } = await callTool("pipedrive_files_list", { mail_message_id: 800 });
    expect(result.isError).toBe(true);
    expect(result.errorMeta).toEqual({ category: "not_found", status: 404 });
    expect(String((result.content[0] as { text: string }).text)).toContain("GET /mailbox/mailMessages/800");
  });

  it("rejects mail_message_id combined with a scope or other filters", async () => {
    const withScope = await callTool("pipedrive_files_list", { deal_id: 117, mail_message_id: 800 });
    expect(withScope.result.isError).toBe(true);
    expect(String((withScope.result.content[0] as { text: string }).text)).toContain("stands alone");
    const withCursor = await callTool("pipedrive_files_list", { mail_message_id: 800, cursor: "offset:100" });
    expect(withCursor.result.isError).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
  });
});

describe("pipedrive_files_get", () => {
  it("returns the compact file with description and a download URL by default", async () => {
    nock(BASE_URL).get("/api/v1/files/9001").query(true).reply(200, fixturesV1("files-get.json"));
    const { result, data } = await callTool("pipedrive_files_get", { file_id: 9001 });
    expect(result.isError).toBeFalsy();
    const file = data as Record<string, unknown>;
    expect(file.id).toBe(9001);
    expect(file.mail_message_id).toBe(800);
    expect(file.description).toBe("Signed proposal");
    expect(file.download_url).toBe("https://testcompany.pipedrive.com/api/v1/files/9001/download");
    expect(file).not.toHaveProperty("s3_bucket");
    expect(file).not.toHaveProperty("url");
  });

  it("omits the download URL when include_download_url is false", async () => {
    nock(BASE_URL).get("/api/v1/files/9001").query(true).reply(200, fixturesV1("files-get.json"));
    const { data } = await callTool("pipedrive_files_get", { file_id: 9001, include_download_url: false });
    expect(data as Record<string, unknown>).not.toHaveProperty("download_url");
  });
});
