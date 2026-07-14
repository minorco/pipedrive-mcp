import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestContext, callTool, BASE_URL } from "../../helpers/setup.js";
import { clearFieldCache } from "../../../src/services/custom-fields.js";

const fixturesV2 = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../fixtures/v2", name), "utf-8"));

beforeAll(async () => {
  await setupTestContext();
});

afterEach(() => {
  nock.cleanAll();
  clearFieldCache();
});

describe("pipedrive_custom_fields_list entity_type=project", () => {
  it("fetches project fields from the v2 projectFields endpoint, not v1", async () => {
    const page2 = fixturesV2("projectFields-list-page2.json");

    const scope = nock(BASE_URL)
      .get("/api/v2/projectFields")
      .query(true)
      .reply(200, { ...page2, additional_data: { next_cursor: null } });

    const { result, data } = await callTool("pipedrive_custom_fields_list", {
      entity_type: "project",
      refresh_cache: true,
    });

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    const parsed = data as Record<string, unknown>;
    expect(parsed.entity_type).toBe("project");
    const fields = parsed.fields as Array<Record<string, unknown>>;
    expect(fields.length).toBe(1);
    expect(fields[0].key).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03");
    expect(fields[0].field_type).toBe("set");
  });

  it("follows the cursor across pages until exhausted", async () => {
    nock(BASE_URL)
      .get("/api/v2/projectFields")
      .query((q) => q.cursor === undefined || q.cursor === "")
      .reply(200, fixturesV2("projectFields-list.json"));
    nock(BASE_URL)
      .get("/api/v2/projectFields")
      .query((q) => q.cursor === "cursor-page-2")
      .reply(200, fixturesV2("projectFields-list-page2.json"));

    const { result, data } = await callTool("pipedrive_custom_fields_list", {
      entity_type: "project",
      refresh_cache: true,
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.field_count).toBe(3);
    const fields = parsed.fields as Array<Record<string, unknown>>;
    expect(fields.map((f) => f.name)).toEqual(["Region", "Budget Code", "Delivery Tags"]);
    // enum options survive the parse
    const region = fields.find((f) => f.name === "Region") as Record<string, unknown>;
    expect(region.options).toEqual([
      { id: 10, label: "North Island" },
      { id: 11, label: "South Island" },
    ]);
  });
});
