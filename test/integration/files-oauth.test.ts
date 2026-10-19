/**
 * File upload in OAuth mode: Bearer header, no api_token in the URL.
 * Uses setupOAuthTestContext, so keep it isolated from API-token-mode tests.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { setupOAuthTestContext, callTool, BASE_URL, TEST_OAUTH_TOKEN } from "../helpers/setup.js";

beforeAll(async () => {
  await setupOAuthTestContext();
});

afterEach(() => {
  nock.cleanAll();
});

describe("pipedrive_files_upload in OAuth mode", () => {
  it("authenticates with the Bearer header and never puts api_token in the URL", async () => {
    let authHeader = "";
    let path = "";
    nock(BASE_URL)
      .post("/v1/files")
      .query(true)
      .reply(function () {
        authHeader = String(this.req.headers.authorization ?? "");
        path = this.req.path;
        return [201, { success: true, data: { id: 9501, name: "hello.txt", deal_id: 117 } }];
      });

    const { result } = await callTool("pipedrive_files_upload", {
      file_name: "hello.txt",
      content_base64: Buffer.from("hello").toString("base64"),
      deal_id: 117,
    });

    expect(result.isError).toBeFalsy();
    expect(authHeader).toBe(`Bearer ${TEST_OAUTH_TOKEN}`);
    expect(path).not.toContain("api_token");
  });
});
