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

describe("pipedrive_project_tasks_list", () => {
  it("returns compact tasks with done/milestone as booleans", async () => {
    nock(BASE_URL).get("/api/v2/tasks").query(true).reply(200, fixturesV2("project-tasks-list.json"));

    const { result, data } = await callTool("pipedrive_project_tasks_list", {});

    expect(result.isError).toBeFalsy();
    const items = (data as Record<string, unknown>).items as Array<Record<string, unknown>>;
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ id: 401, title: "Draft sitemap", project_id: 1, done: false });
    expect(items[1]).toMatchObject({ id: 402, parent_task_id: 401, done: true });
  });

  it("passes project_id, is_done, and parent_task_id filters through", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/tasks")
      .query((q) => q.project_id === "1" && q.is_done === "false" && q.parent_task_id === "null")
      .reply(200, fixturesV2("project-tasks-list.json"));

    const { result } = await callTool("pipedrive_project_tasks_list", {
      project_id: 1,
      is_done: false,
      parent_task_id: "null",
    });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});

describe("pipedrive_project_tasks_get", () => {
  it("returns a single task", async () => {
    nock(BASE_URL).get("/api/v2/tasks/401").query(true).reply(200, fixturesV2("project-tasks-get.json"));

    const { result, data } = await callTool("pipedrive_project_tasks_get", { task_id: 401 });
    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.id).toBe(401);
    expect(parsed.title).toBe("Draft sitemap");
  });
});

describe("pipedrive_project_tasks_create", () => {
  it("creates a subtask and encodes milestone as 0/1", async () => {
    let capturedBody: Record<string, unknown> = {};
    nock(BASE_URL)
      .post("/api/v2/tasks", (body) => {
        capturedBody = body as Record<string, unknown>;
        return true;
      })
      .query(true)
      .reply(201, fixturesV2("project-tasks-create.json"));

    const { result, data } = await callTool("pipedrive_project_tasks_create", {
      title: "Content audit",
      project_id: 1,
      parent_task_id: 401,
      milestone: true,
      due_date: "2026-07-30",
    });

    expect(result.isError).toBeFalsy();
    expect(capturedBody).toMatchObject({ title: "Content audit", project_id: 1, parent_task_id: 401, milestone: 1 });
    const task = (data as Record<string, unknown>).task as Record<string, unknown>;
    expect(task.id).toBe(403);
    expect(task.milestone).toBe(true);
  });

  it("requires project_id", async () => {
    const { result } = await callTool("pipedrive_project_tasks_create", { title: "No project" });
    expect(result.isError).toBe(true);
  });
});

describe("pipedrive_project_tasks_update", () => {
  it("PATCHes the task and encodes done as 0/1", async () => {
    const scope = nock(BASE_URL)
      .patch("/api/v2/tasks/401", (body) => (body as Record<string, unknown>).done === 1)
      .query(true)
      .reply(200, fixturesV2("project-tasks-get.json"));

    const { result } = await callTool("pipedrive_project_tasks_update", { task_id: 401, done: true });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});

describe("pipedrive_project_tasks_delete", () => {
  it("dry_run previews without calling the API", async () => {
    const { result, data } = await callTool("pipedrive_project_tasks_delete", { task_id: 401, confirm: "DELETE", dry_run: true });
    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).dry_run).toBe(true);
  });

  it("refuses without confirm", async () => {
    const { result } = await callTool("pipedrive_project_tasks_delete", { task_id: 401 });
    expect(result.isError).toBe(true);
  });

  it("deletes with confirm", async () => {
    const scope = nock(BASE_URL).delete("/api/v2/tasks/401").query(true).reply(200, { success: true, data: { id: 401 } });

    const { result } = await callTool("pipedrive_project_tasks_delete", { task_id: 401, confirm: "DELETE" });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});
