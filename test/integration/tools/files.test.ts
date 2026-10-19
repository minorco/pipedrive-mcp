import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { setupTestContext, callTool, BASE_URL, TEST_API_TOKEN } from "../../helpers/setup.js";

beforeAll(async () => {
  await setupTestContext();
});

afterEach(() => {
  nock.cleanAll();
});

describe("pipedrive_files_upload", () => {
  it("sends multipart through the shared client with api_token auth", async () => {
    let authHeader: string | undefined;
    let contentType = "";
    let body = "";
    nock(BASE_URL)
      .post("/v1/files")
      .query({ api_token: TEST_API_TOKEN })
      .reply(function (_uri, requestBody) {
        authHeader = this.req.headers.authorization as string | undefined;
        contentType = String(this.req.headers["content-type"] ?? "");
        body = typeof requestBody === "string" ? requestBody : Buffer.from(requestBody as Buffer).toString();
        return [201, { success: true, data: { id: 9501, name: "hello.txt", deal_id: 117 } }];
      });

    const { result } = await callTool("pipedrive_files_upload", {
      file_name: "hello.txt",
      content_base64: Buffer.from("hello").toString("base64"),
      deal_id: 117,
    });

    expect(result.isError).toBeFalsy();
    expect(authHeader).toBeUndefined();
    expect(contentType).toContain("multipart/form-data; boundary=");
    expect(body).toContain('filename="hello.txt"');
    expect(body).toContain("hello");
    expect(body).toContain('name="deal_id"');
  });

  it("returns a normalised error when Pipedrive rejects the upload", async () => {
    nock(BASE_URL)
      .post("/v1/files")
      .query(true)
      .reply(400, { success: false, error: "Invalid file" });

    const { result } = await callTool("pipedrive_files_upload", {
      file_name: "hello.txt",
      content_base64: Buffer.from("hello").toString("base64"),
      deal_id: 117,
    });

    expect(result.isError).toBe(true);
  });

  it("does not retry a 5xx upload and warns it may have been saved", async () => {
    let calls = 0;
    nock(BASE_URL)
      .post("/v1/files")
      .query(true)
      .times(3)
      .reply(() => {
        calls++;
        return [503, { success: false, error: "Service unavailable" }];
      });

    const { result, data } = await callTool("pipedrive_files_upload", {
      file_name: "hello.txt",
      content_base64: Buffer.from("hello").toString("base64"),
      deal_id: 117,
    });

    expect(result.isError).toBe(true);
    expect(calls).toBe(1);
    expect(String(data)).toContain("pipedrive_files_list");
  });

  it("does not retry after a network error and warns it may have been saved", async () => {
    nock(BASE_URL)
      .post("/v1/files")
      .query(true)
      .replyWithError("socket hang up");
    const extra = nock(BASE_URL).post("/v1/files").query(true).reply(201, { success: true, data: { id: 1 } });

    const { result, data } = await callTool("pipedrive_files_upload", {
      file_name: "hello.txt",
      content_base64: Buffer.from("hello").toString("base64"),
      deal_id: 117,
    });

    expect(result.isError).toBe(true);
    expect(extra.isDone()).toBe(false);
    expect(String(data)).toContain("may have been saved");
  });
});
