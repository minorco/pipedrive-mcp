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

describe("pipedrive_project_boards_list", () => {
  it("lists boards", async () => {
    nock(BASE_URL).get("/api/v2/boards").query(true).reply(200, fixturesV2("boards-list.json"));

    const { result, data } = await callTool("pipedrive_project_boards_list", {});
    expect(result.isError).toBeFalsy();
    const boards = (data as Record<string, unknown>).boards as Array<Record<string, unknown>>;
    expect(boards.map((b) => b.name)).toEqual(["Client Delivery", "Internal Ops"]);
  });
});

describe("pipedrive_project_boards_get", () => {
  it("gets a board", async () => {
    nock(BASE_URL).get("/api/v2/boards/1").query(true).reply(200, { success: true, data: { id: 1, name: "Client Delivery", order_nr: 1 } });

    const { result, data } = await callTool("pipedrive_project_boards_get", { board_id: 1 });
    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).name).toBe("Client Delivery");
  });
});

describe("pipedrive_project_boards_create/update/delete", () => {
  it("creates a board", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/boards", (body) => (body as Record<string, unknown>).name === "New Board")
      .query(true)
      .reply(201, { success: true, data: { id: 3, name: "New Board", order_nr: 3 } });

    const { result } = await callTool("pipedrive_project_boards_create", { name: "New Board" });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("updates a board", async () => {
    const scope = nock(BASE_URL)
      .patch("/api/v2/boards/3", (body) => (body as Record<string, unknown>).order_nr === 1)
      .query(true)
      .reply(200, { success: true, data: { id: 3, name: "New Board", order_nr: 1 } });

    const { result } = await callTool("pipedrive_project_boards_update", { board_id: 3, order_nr: 1 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("refuses delete without confirm and deletes with it", async () => {
    const { result: refused } = await callTool("pipedrive_project_boards_delete", { board_id: 3 });
    expect(refused.isError).toBe(true);

    const scope = nock(BASE_URL).delete("/api/v2/boards/3").query(true).reply(200, { success: true, data: { id: 3 } });
    const { result } = await callTool("pipedrive_project_boards_delete", { board_id: 3, confirm: "DELETE" });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});

describe("pipedrive_project_phases_list", () => {
  it("requires board_id", async () => {
    const { result } = await callTool("pipedrive_project_phases_list", {});
    expect(result.isError).toBe(true);
  });

  it("lists phases for a board", async () => {
    const scope = nock(BASE_URL)
      .get("/api/v2/phases")
      .query((q) => q.board_id === "1")
      .reply(200, fixturesV2("phases-list.json"));

    const { result, data } = await callTool("pipedrive_project_phases_list", { board_id: 1 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
    const phases = (data as Record<string, unknown>).phases as Array<Record<string, unknown>>;
    expect(phases.length).toBe(4);
    expect(phases[0]).toMatchObject({ id: 1, name: "Kickoff", board_id: 1 });
  });
});

describe("pipedrive_project_phases_get/create/update/delete", () => {
  it("gets a phase", async () => {
    nock(BASE_URL).get("/api/v2/phases/2").query(true).reply(200, { success: true, data: { id: 2, name: "In Progress", board_id: 1, order_nr: 2 } });

    const { result, data } = await callTool("pipedrive_project_phases_get", { phase_id: 2 });
    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).name).toBe("In Progress");
  });

  it("creates a phase on a board", async () => {
    const scope = nock(BASE_URL)
      .post("/api/v2/phases", (body) => {
        const b = body as Record<string, unknown>;
        return b.name === "UAT" && b.board_id === 1;
      })
      .query(true)
      .reply(201, { success: true, data: { id: 5, name: "UAT", board_id: 1, order_nr: 4 } });

    const { result } = await callTool("pipedrive_project_phases_create", { name: "UAT", board_id: 1 });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("requires board_id on create", async () => {
    const { result } = await callTool("pipedrive_project_phases_create", { name: "UAT" });
    expect(result.isError).toBe(true);
  });

  it("updates a phase", async () => {
    const scope = nock(BASE_URL)
      .patch("/api/v2/phases/5", (body) => (body as Record<string, unknown>).name === "User Acceptance")
      .query(true)
      .reply(200, { success: true, data: { id: 5, name: "User Acceptance", board_id: 1, order_nr: 4 } });

    const { result } = await callTool("pipedrive_project_phases_update", { phase_id: 5, name: "User Acceptance" });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it("dry_run delete previews without calling the API", async () => {
    const { result, data } = await callTool("pipedrive_project_phases_delete", { phase_id: 5, confirm: "DELETE", dry_run: true });
    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).dry_run).toBe(true);
  });

  it("deletes a phase with confirm", async () => {
    const scope = nock(BASE_URL).delete("/api/v2/phases/5").query(true).reply(200, { success: true, data: { id: 5 } });

    const { result } = await callTool("pipedrive_project_phases_delete", { phase_id: 5, confirm: "DELETE" });
    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});
