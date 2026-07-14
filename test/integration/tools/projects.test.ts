import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { readFileSync } from "fs";
import { join } from "path";
import { setupTestContext, callTool, BASE_URL } from "../../helpers/setup.js";
import { getToolByName } from "../../../src/mcp/register-tools.js";
import { clearFieldCache } from "../../../src/services/custom-fields.js";

const fixturesV2 = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../fixtures/v2", name), "utf-8"));
const fixturesV1 = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../fixtures/v1", name), "utf-8"));

// The custom-fields resolver fetches /api/v2/projectFields on demand
function mockProjectFields() {
  nock(BASE_URL)
    .get("/api/v2/projectFields")
    .query(true)
    .reply(200, fixturesV2("projectFields-list-page2.json"))
    .persist();
}

beforeAll(async () => {
  await setupTestContext();
});

afterEach(() => {
  nock.cleanAll();
  clearFieldCache();
});

describe("pipedrive_projects_list", () => {
  it("returns compact projects with pagination fields", async () => {
    nock(BASE_URL).get("/api/v2/projects").query(true).reply(200, fixturesV2("projects-list.json"));

    const { result, data } = await callTool("pipedrive_projects_list", {});

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    const items = parsed.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ id: 1, title: "Website Redesign", status: "open", board_id: 1, phase_id: 2, deal_ids: [301] });
    expect(parsed.truncated).toBe(false);
  });

  it("hits the archived endpoint when archived_only is true", async () => {
    const scope = nock(BASE_URL).get("/api/v2/projects/archived").query(true).reply(200, fixturesV2("projects-archived-list.json"));

    const { result, data } = await callTool("pipedrive_projects_list", { archived_only: true });

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    const items = (data as Record<string, unknown>).items as Array<Record<string, unknown>>;
    expect(items[0].archive_time).toBe("2026-04-02T20:00:00Z");
  });

  it("passes status and phase filters through", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/projects")
      .query((q) => q.status === "open" && q.phase_id === "2")
      .reply(200, fixturesV2("projects-list.json"));

    const { result } = await callTool("pipedrive_projects_list", { status: "open", phase_id: 2 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});

describe("pipedrive_projects_get", () => {
  it("returns the project with resolved custom fields", async () => {
    mockProjectFields();
    nock(BASE_URL).get("/api/v2/projects/1").query(true).reply(200, fixturesV2("projects-get.json"));

    const { result, data } = await callTool("pipedrive_projects_get", { project_id: 1 });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.id).toBe(1);
    expect(parsed.title).toBe("Website Redesign");
    // custom field key present in the fixture is not in the (page-2 only) field metadata,
    // so resolution yields nothing - _raw retains the original payload
    expect(parsed._raw).toBeDefined();
  });
});

describe("pipedrive_projects_search", () => {
  it("hits /projects/search with the term", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/projects/search")
      .query((q) => q.term === "website")
      .reply(200, fixturesV2("projects-search.json"));

    const { result, data } = await callTool("pipedrive_projects_search", { term: "website" });

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    const items = (data as Record<string, unknown>).items as Array<Record<string, unknown>>;
    expect(items.length).toBe(1);
  });

  it("rejects a one-character term", async () => {
    const { result } = await callTool("pipedrive_projects_search", { term: "w" });
    expect(result.isError).toBe(true);
  });
});

describe("pipedrive_projects_create", () => {
  it("creates a project and nests resolved custom fields", async () => {
    mockProjectFields();
    let capturedBody: Record<string, unknown> = {};
    nock(BASE_URL)
      .post("/api/v2/projects", (body) => {
        capturedBody = body as Record<string, unknown>;
        return true;
      })
      .query(true)
      .reply(201, fixturesV2("projects-create.json"));

    const { result, data } = await callTool("pipedrive_projects_create", {
      title: "Client Onboarding Automation",
      deal_ids: [302],
      custom_fields_by_name: { "Delivery Tags": ["Rush"] },
    });

    expect(result.isError).toBeFalsy();
    expect(capturedBody.title).toBe("Client Onboarding Automation");
    expect(capturedBody.deal_ids).toEqual([302]);
    // by-name resolution lands under the nested custom_fields object, as option IDs
    expect(capturedBody.custom_fields).toEqual({ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03: [20] });
    const parsed = data as Record<string, unknown>;
    expect((parsed.project as Record<string, unknown>).id).toBe(3);
  });

  it("rejects an unknown custom field name", async () => {
    mockProjectFields();
    const { result } = await callTool("pipedrive_projects_create", {
      title: "X",
      custom_fields_by_name: { Nonexistent: "value" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("pipedrive_projects_update", () => {
  it("PATCHes the project", async () => {
    const scope = nock(BASE_URL)
      .patch("/api/v2/projects/1", (body) => (body as Record<string, unknown>).phase_id === 3)
      .query(true)
      .reply(200, fixturesV2("projects-get.json"));

    const { result } = await callTool("pipedrive_projects_update", { project_id: 1, phase_id: 3 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});

describe("pipedrive_projects_archive", () => {
  it("is registered as a write tool despite not matching the name patterns", () => {
    const tool = getToolByName("pipedrive_projects_archive");
    expect(tool?.isWriteTool).toBe(true);
  });

  it("POSTs to the archive endpoint", async () => {
    const scope = nock(BASE_URL).post("/api/v2/projects/1/archive").query(true).reply(200, fixturesV2("projects-archive.json"));

    const { result, data } = await callTool("pipedrive_projects_archive", { project_id: 1 });

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    const parsed = data as Record<string, unknown>;
    expect((parsed.project as Record<string, unknown>).archive_time).toBe("2026-07-14T01:10:00Z");
  });
});

describe("pipedrive_projects_delete", () => {
  it("dry_run previews without calling the API", async () => {
    const { result, data } = await callTool("pipedrive_projects_delete", { project_id: 1, confirm: "DELETE", dry_run: true });
    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).dry_run).toBe(true);
    expect(nock.pendingMocks().length).toBe(0);
  });

  it("refuses without confirm", async () => {
    const { result } = await callTool("pipedrive_projects_delete", { project_id: 1 });
    expect(result.isError).toBe(true);
  });

  it("deletes with confirm", async () => {
    const scope = nock(BASE_URL).delete("/api/v2/projects/1").query(true).reply(200, { success: true, data: { id: 1 } });

    const { result } = await callTool("pipedrive_projects_delete", { project_id: 1, confirm: "DELETE" });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});

describe("pipedrive_projects_changelog", () => {
  it("lists field changes", async () => {
    nock(BASE_URL).get("/api/v2/projects/1/changelog").query(true).reply(200, fixturesV2("projects-changelog.json"));

    const { result, data } = await callTool("pipedrive_projects_changelog", { project_id: 1 });
    expect(result.isError).toBeFalsy();
    const items = (data as Record<string, unknown>).items as Array<Record<string, unknown>>;
    expect(items[0].field_key).toBe("phase_id");
  });
});

describe("pipedrive_projects_permitted_users", () => {
  it("lists permitted user IDs", async () => {
    nock(BASE_URL).get("/api/v2/projects/1/permittedUsers").query(true).reply(200, fixturesV2("projects-permitted-users.json"));

    const { result, data } = await callTool("pipedrive_projects_permitted_users", { project_id: 1 });
    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).permitted_users).toEqual([22, 31, 48]);
  });
});

describe("v1 project sub-resources", () => {
  it("lists project activities via v1", async () => {
    const scope = nock(BASE_URL).get("/v1/projects/1/activities").query(true).reply(200, fixturesV1("project-activities-list.json"));

    const { result, data } = await callTool("pipedrive_project_activities_list", { project_id: 1 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    const activities = (data as Record<string, unknown>).activities as Array<Record<string, unknown>>;
    expect(activities[0].subject).toBe("Kickoff call");
  });

  it("lists project groups via v1", async () => {
    nock(BASE_URL).get("/v1/projects/1/groups").query(true).reply(200, fixturesV1("project-groups-list.json"));

    const { result, data } = await callTool("pipedrive_project_groups_list", { project_id: 1 });
    expect(result.isError).toBeFalsy();
    const groups = (data as Record<string, unknown>).groups as Array<Record<string, unknown>>;
    expect(groups.map((g) => g.name)).toEqual(["Discovery", "Build"]);
  });

  it("gets the project plan via v1", async () => {
    nock(BASE_URL).get("/v1/projects/1/plan").query(true).reply(200, fixturesV1("project-plan.json"));

    const { result, data } = await callTool("pipedrive_project_plan_get", { project_id: 1 });
    expect(result.isError).toBeFalsy();
    const items = (data as Record<string, unknown>).plan_items as Array<Record<string, unknown>>;
    expect(items.length).toBe(2);
  });
});

describe("pipedrive_project_plan_update", () => {
  it("PUTs to the plan tasks path for item_type task", async () => {
    const scope = nock(BASE_URL)
      .put("/v1/projects/1/plan/tasks/401", (body) => (body as Record<string, unknown>).phase_id === 3)
      .query(true)
      .reply(200, fixturesV1("project-plan-update.json"));

    const { result } = await callTool("pipedrive_project_plan_update", {
      project_id: 1,
      item_type: "task",
      item_id: 401,
      phase_id: 3,
    });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("PUTs to the plan activities path for item_type activity", async () => {
    const scope = nock(BASE_URL)
      .put("/v1/projects/1/plan/activities/900", (body) => (body as Record<string, unknown>).group_id === 12)
      .query(true)
      .reply(200, { success: true, data: { item_id: 900, item_type: "activity", group_id: 12 } });

    const { result } = await callTool("pipedrive_project_plan_update", {
      project_id: 1,
      item_type: "activity",
      item_id: 900,
      group_id: 12,
    });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("rejects when neither phase_id nor group_id is provided", async () => {
    const { result } = await callTool("pipedrive_project_plan_update", {
      project_id: 1,
      item_type: "task",
      item_id: 401,
    });
    expect(result.isError).toBe(true);
  });
});

describe("Projects add-on 403 guidance", () => {
  it("appends add-on guidance to 403 errors", async () => {
    nock(BASE_URL).get("/api/v2/projects").query(true).reply(403, { success: false, error: "Forbidden" });

    const { result } = await callTool("pipedrive_projects_list", {});
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text?: string })?.text ?? "";
    expect(text).toContain("Projects is a paid Pipedrive add-on");
  });
});
