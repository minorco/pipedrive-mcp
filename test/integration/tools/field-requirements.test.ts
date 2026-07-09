import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestContext, callTool, BASE_URL } from "../../helpers/setup.js";
import { clearFieldRequirementsCache } from "../../../src/services/field-requirements.js";

const fixturesV2 = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../fixtures/v2", name), "utf-8"));

const REQUIREMENTS_FIXTURE = "dealFields-requirements.json";
const DEAL_SOURCE_KEY = "f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5";
const KICKOFF_NOTES_KEY = "a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6";
const BUDGET_KEY = "c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";

function mockRequirements() {
  nock(BASE_URL)
    .get("/api/v2/dealFields")
    .query((q) => String(q.include_fields ?? "").includes("required_fields"))
    .reply(200, fixturesV2(REQUIREMENTS_FIXTURE));
}

beforeAll(async () => {
  await setupTestContext();
});

afterEach(() => {
  nock.cleanAll();
  clearFieldRequirementsCache();
});

describe("pipedrive_deals_move_stage dry_run", () => {
  it("previews required and important fields at the target stage without moving", async () => {
    nock(BASE_URL)
      .get("/api/v2/deals/117")
      .query(true)
      .reply(200, fixturesV2("deals-get.json"));
    mockRequirements();

    const { result, data } = await callTool("pipedrive_deals_move_stage", {
      deal_id: 117,
      stage_id: 2,
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.dry_run).toBe(true);
    const reqs = parsed.field_requirements as Record<string, unknown>;
    expect(reqs).toBeDefined();
    const required = reqs.required_missing as Array<Record<string, unknown>>;
    expect(required.map((f) => f.name).sort()).toEqual(["Deal Source", "Kickoff Notes"]);
    const dealSource = required.find((f) => f.key === DEAL_SOURCE_KEY)!;
    expect(dealSource.options).toEqual([
      { id: 401, label: "Referral" },
      { id: 402, label: "Outbound" },
    ]);
    const important = reqs.important_missing as Array<Record<string, unknown>>;
    expect(important.map((f) => f.key)).toEqual([BUDGET_KEY]);
  });

  it("reports when requirement config is unavailable", async () => {
    nock(BASE_URL)
      .get("/api/v2/deals/117")
      .query(true)
      .reply(200, fixturesV2("deals-get.json"));
    nock(BASE_URL)
      .get("/api/v2/dealFields")
      .query(true)
      .reply(404, { success: false, error: "Not found" });

    const { result, data } = await callTool("pipedrive_deals_move_stage", {
      deal_id: 117,
      stage_id: 2,
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.dry_run).toBe(true);
    expect(parsed.field_requirements).toBeUndefined();
    expect(parsed.field_requirements_unavailable).toBe(true);
  });
});

describe("pipedrive_deals_move_stage", () => {
  it("attaches field_requirements when required fields are missing after the move", async () => {
    const dealFixture = fixturesV2("deals-get.json");
    const moved = { ...dealFixture, data: { ...dealFixture.data, stage_id: 2 } };
    nock(BASE_URL).patch("/api/v2/deals/117").query(true).reply(200, moved);
    mockRequirements();

    const { result, data } = await callTool("pipedrive_deals_move_stage", {
      deal_id: 117,
      stage_id: 2,
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.message).toContain("moved to stage 2");
    const reqs = parsed.field_requirements as Record<string, unknown>;
    const required = reqs.required_missing as Array<Record<string, unknown>>;
    expect(required.map((f) => f.name).sort()).toEqual(["Deal Source", "Kickoff Notes"]);
    expect(reqs.note).toBeTruthy();
  });

  it("omits field_requirements when everything is populated", async () => {
    const dealFixture = fixturesV2("deals-get.json");
    const moved = {
      ...dealFixture,
      data: {
        ...dealFixture.data,
        stage_id: 2,
        custom_fields: {
          ...dealFixture.data.custom_fields,
          [DEAL_SOURCE_KEY]: 401,
          [KICKOFF_NOTES_KEY]: "Kickoff booked for Friday",
          [BUDGET_KEY]: 5000,
        },
      },
    };
    nock(BASE_URL).patch("/api/v2/deals/117").query(true).reply(200, moved);
    mockRequirements();

    const { result, data } = await callTool("pipedrive_deals_move_stage", {
      deal_id: 117,
      stage_id: 2,
    });

    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).field_requirements).toBeUndefined();
  });

  it("still moves the deal when the requirements endpoint is unavailable", async () => {
    const dealFixture = fixturesV2("deals-get.json");
    const moved = { ...dealFixture, data: { ...dealFixture.data, stage_id: 2 } };
    nock(BASE_URL).patch("/api/v2/deals/117").query(true).reply(200, moved);
    nock(BASE_URL)
      .get("/api/v2/dealFields")
      .query(true)
      .reply(404, { success: false, error: "Not found" });

    const { result, data } = await callTool("pipedrive_deals_move_stage", {
      deal_id: 117,
      stage_id: 2,
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.message).toContain("moved to stage 2");
    expect(parsed.field_requirements).toBeUndefined();
  });
});

describe("pipedrive_deals_create", () => {
  it("attaches field_requirements and a value hint for a bare new deal", async () => {
    const dealFixture = fixturesV2("deals-get.json");
    const created = {
      ...dealFixture,
      data: { ...dealFixture.data, stage_id: 2, value: 0 },
    };
    nock(BASE_URL).post("/api/v2/deals").query(true).reply(201, created);
    mockRequirements();

    const { result, data } = await callTool("pipedrive_deals_create", {
      title: "Acme Corp - Enterprise Package",
      stage_id: 2,
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    const reqs = parsed.field_requirements as Record<string, unknown>;
    const required = reqs.required_missing as Array<Record<string, unknown>>;
    expect(required.map((f) => f.name).sort()).toEqual(["Deal Source", "Kickoff Notes"]);
    expect(parsed.value_hint).toBeTruthy();
  });
});

describe("pipedrive_deals_update", () => {
  it("checks status-based requirements when marking a deal lost", async () => {
    const dealFixture = fixturesV2("deals-get.json");
    const lost = { ...dealFixture, data: { ...dealFixture.data, status: "lost" } };
    nock(BASE_URL).patch("/api/v2/deals/117").query(true).reply(200, lost);
    mockRequirements();

    const { result, data } = await callTool("pipedrive_deals_update", {
      deal_id: 117,
      status: "lost",
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    const reqs = parsed.field_requirements as Record<string, unknown>;
    const required = reqs.required_missing as Array<Record<string, unknown>>;
    expect(required.map((f) => f.name)).toContain("Loss Reason Detail");
  });

  it("does not run the check on a plain field update", async () => {
    const dealFixture = fixturesV2("deals-get.json");
    nock(BASE_URL).patch("/api/v2/deals/117").query(true).reply(200, dealFixture);

    const { result, data } = await callTool("pipedrive_deals_update", {
      deal_id: 117,
      title: "New title",
    });

    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).field_requirements).toBeUndefined();
  });
});

describe("pipedrive_deal_products_add", () => {
  it("returns the deal's recalculated value after attaching a product", async () => {
    nock(BASE_URL)
      .post("/api/v2/deals/117/products")
      .query(true)
      .reply(201, {
        success: true,
        data: { id: 3, deal_id: 117, product_id: 9, item_price: 6000, quantity: 2 },
      });
    const dealFixture = fixturesV2("deals-get.json");
    const recalculated = { ...dealFixture, data: { ...dealFixture.data, value: 12000 } };
    nock(BASE_URL).get("/api/v2/deals/117").query(true).reply(200, recalculated);

    const { result, data } = await callTool("pipedrive_deal_products_add", {
      deal_id: 117,
      product_id: 9,
      item_price: 6000,
      quantity: 2,
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    const dealValue = parsed.deal_value as Record<string, unknown>;
    expect(dealValue.value).toBe(12000);
    expect(dealValue.currency).toBe("USD");
    expect(String(dealValue.note)).toContain("asynchronously");
  });
});
