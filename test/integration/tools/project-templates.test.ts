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

describe("pipedrive_project_templates_list", () => {
  it("lists templates with pagination fields", async () => {
    nock(BASE_URL).get("/api/v2/projectTemplates").query(true).reply(200, fixturesV2("project-templates-list.json"));

    const { result, data } = await callTool("pipedrive_project_templates_list", {});
    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    const items = parsed.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ id: 51, title: "Standard Automation Build", owner_id: 22 });
    expect(parsed.truncated).toBe(false);
  });
});

describe("pipedrive_project_templates_get", () => {
  it("gets a template by ID", async () => {
    nock(BASE_URL)
      .get("/api/v2/projectTemplates/51")
      .query(true)
      .reply(200, { success: true, data: { id: 51, title: "Standard Automation Build", description: "Discovery, build, UAT, handover", owner_id: 22 } });

    const { result, data } = await callTool("pipedrive_project_templates_get", { template_id: 51 });
    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.title).toBe("Standard Automation Build");
    expect(parsed._raw).toBeDefined();
  });
});
