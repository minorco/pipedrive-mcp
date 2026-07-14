import { describe, it, expect } from "vitest";
import { normalizeProjectsApiError } from "../../../src/services/projects-errors.js";
import type { HttpResponse } from "../../../src/pipedrive/http-client.js";

function response(status: number, error = ""): HttpResponse {
  return { status, headers: {}, data: { success: false, error } } as HttpResponse;
}

describe("normalizeProjectsApiError", () => {
  it("appends Projects add-on guidance on 403", () => {
    const err = normalizeProjectsApiError(response(403), "pipedrive_projects_list", "GET /projects");
    expect(err.category).toBe("auth");
    expect(err.guidance).toContain("Projects is a paid Pipedrive add-on");
  });

  it("leaves other statuses untouched", () => {
    const notFound = normalizeProjectsApiError(response(404), "pipedrive_projects_get", "GET /projects/9");
    expect(notFound.guidance).not.toContain("add-on");
    const badRequest = normalizeProjectsApiError(response(400, "title is required"), "pipedrive_projects_create", "POST /projects");
    expect(badRequest.guidance).toBe("title is required");
  });
});
