import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { setupOAuthTestContext, callTool, BASE_URL, TEST_OAUTH_TOKEN } from "../../helpers/setup.js";

beforeAll(async () => {
  await setupOAuthTestContext();
});

afterEach(() => {
  nock.cleanAll();
});

describe("pipedrive_files_upload under OAuth", () => {
  it("authenticates with the Bearer header and never puts api_token in the URL", async () => {
    let authHeader = "";
    let url = "";
    nock(BASE_URL)
      .post("/api/v1/files")
      .query(true)
      .reply(function () {
        authHeader = String(this.req.headers.authorization ?? "");
        url = this.req.path;
        return [201, { success: true, data: { id: 9501, name: "hello.txt", file_name: "hello.txt", deal_id: 117 } }];
      });

    const { result } = await callTool("pipedrive_files_upload", {
      file_name: "hello.txt",
      content_base64: Buffer.from("hello").toString("base64"),
      deal_id: 117,
    });

    expect(result.isError).toBeFalsy();
    expect(authHeader).toBe(`Bearer ${TEST_OAUTH_TOKEN}`);
    expect(url).not.toContain("api_token");
  });
});
