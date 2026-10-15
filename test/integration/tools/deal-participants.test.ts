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

describe("pipedrive_deal_participants_list", () => {
  it("lists participants via v1 and compacts expanded and bare references", async () => {
    let query: Record<string, string> = {};
    nock(BASE_URL)
      .get("/api/v1/deals/117/participants")
      .query((q) => {
        query = q as Record<string, string>;
        return true;
      })
      .reply(200, fixturesV1("deal-participants-list.json"));

    const { result, data } = await callTool("pipedrive_deal_participants_list", { deal_id: 117 });

    expect(result.isError).toBeFalsy();
    expect(query.start).toBe("0");
    const parsed = data as Record<string, unknown>;
    const items = parsed.items as Array<Record<string, unknown>>;
    expect(items).toEqual([
      {
        id: 301,
        person_id: 201,
        name: "Jane Smith",
        emails: ["jane.smith@example.com"],
        phones: ["+1 555 0100"],
        org_id: 301,
        add_time: "2026-03-20 10:00:00",
        added_by_user_id: 101,
      },
      {
        id: 302,
        person_id: 202,
        name: "Tom Jones",
        emails: ["tom.jones@example.com"],
        phones: [],
        org_id: 301,
        add_time: "2026-03-21 11:30:00",
        added_by_user_id: 101,
      },
    ]);
    expect(parsed.next_page_token).toBeNull();
  });

  it("surfaces a 404 for an unknown deal as an API error", async () => {
    nock(BASE_URL).get("/api/v1/deals/999/participants").query(true).reply(404, { success: false, error: "Deal not found" });
    const { result } = await callTool("pipedrive_deal_participants_list", { deal_id: 999 });
    expect(result.isError).toBe(true);
    expect(result.errorMeta).toEqual({ category: "not_found", status: 404 });
  });
});

describe("pipedrive_deal_participants_add", () => {
  it("posts person_id to v1 and returns the compact participant", async () => {
    let body: Record<string, unknown> = {};
    const fixture = fixturesV1("deal-participants-list.json");
    nock(BASE_URL)
      .post("/api/v1/deals/117/participants", (b) => {
        body = b as Record<string, unknown>;
        return true;
      })
      .query(true)
      .reply(200, { success: true, data: fixture.data[0] });

    const { result, data } = await callTool("pipedrive_deal_participants_add", { deal_id: 117, person_id: 201 });

    expect(result.isError).toBeFalsy();
    expect(body).toEqual({ person_id: 201 });
    const parsed = data as Record<string, unknown>;
    expect(parsed.message).toBe("Person 201 added as a participant on deal 117");
    expect((parsed.participant as Record<string, unknown>).id).toBe(301);
  });

  it("rejects unknown params (strict schema)", async () => {
    const { result } = await callTool("pipedrive_deal_participants_add", { deal_id: 117, person_id: 201, primary: true });
    expect(result.isError).toBe(true);
  });

  it("is registered as a write tool", async () => {
    const { getToolByName } = await import("../../../src/mcp/register-tools.js");
    expect(getToolByName("pipedrive_deal_participants_add")?.isWriteTool).toBe(true);
    expect(getToolByName("pipedrive_deal_participants_delete")?.isWriteTool).toBe(true);
    expect(getToolByName("pipedrive_deal_participants_list")?.isWriteTool).toBe(false);
  });
});

describe("pipedrive_deal_participants_delete", () => {
  it("requires confirm and makes no API call without it", async () => {
    const { result } = await callTool("pipedrive_deal_participants_delete", { deal_id: 117, deal_participant_id: 301 });
    expect(result.isError).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it("dry_run previews without calling the API", async () => {
    const { result, data } = await callTool("pipedrive_deal_participants_delete", {
      deal_id: 117,
      deal_participant_id: 301,
      confirm: "DELETE",
      dry_run: true,
    });
    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.dry_run).toBe(true);
    expect(parsed.target).toEqual({ deal_id: 117, deal_participant_id: 301 });
  });

  it("deletes the participant link via v1 when confirmed", async () => {
    const scope = nock(BASE_URL)
      .delete("/api/v1/deals/117/participants/301")
      .query(true)
      .reply(200, { success: true, data: { id: 301 } });

    const { result, data } = await callTool("pipedrive_deal_participants_delete", {
      deal_id: 117,
      deal_participant_id: 301,
      confirm: "DELETE",
    });

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    expect((data as Record<string, unknown>).message).toBe("Participant 301 removed from deal 117");
  });
});
