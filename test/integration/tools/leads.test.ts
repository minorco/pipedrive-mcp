import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { setupTestContext, callTool, BASE_URL } from "../../helpers/setup.js";

beforeAll(async () => {
  await setupTestContext();
});

afterEach(() => {
  nock.cleanAll();
});

const leadFixture = {
  success: true,
  data: {
    id: "adf21080-0e10-11eb-879b-46d8c6e15c39",
    title: "New lead",
    owner_id: 101,
    person_id: 239,
    organization_id: null,
    visible_to: "3",
    add_time: "2026-09-09T00:00:00.000Z",
  },
};

describe("pipedrive_leads_create", () => {
  it("sends visible_to as the string the v1 leads API expects", async () => {
    let sent: Record<string, unknown> = {};
    nock(BASE_URL)
      .post("/api/v1/leads", (body: Record<string, unknown>) => {
        sent = body;
        return true;
      })
      .query(true)
      .reply(201, leadFixture);

    const { result } = await callTool("pipedrive_leads_create", { title: "New lead", person_id: 239, visible_to: "3" });
    expect(result.isError).toBeFalsy();
    expect(sent.visible_to).toBe("3");
    expect(sent.person_id).toBe(239);
  });

  it("requires a person or organization", async () => {
    const { result } = await callTool("pipedrive_leads_create", { title: "Orphan" });
    expect(result.isError).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
  });
});

describe("pipedrive_leads_update", () => {
  it("sends visible_to as a string", async () => {
    let sent: Record<string, unknown> = {};
    nock(BASE_URL)
      .patch("/api/v1/leads/adf21080-0e10-11eb-879b-46d8c6e15c39", (body: Record<string, unknown>) => {
        sent = body;
        return true;
      })
      .query(true)
      .reply(200, leadFixture);

    const { result } = await callTool("pipedrive_leads_update", { lead_id: "adf21080-0e10-11eb-879b-46d8c6e15c39", visible_to: "7" });
    expect(result.isError).toBeFalsy();
    expect(sent.visible_to).toBe("7");
  });
});
