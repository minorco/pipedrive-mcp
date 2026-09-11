import { describe, it, expect, vi, beforeEach } from "vitest";

// Two accounts (and two users on the second) served from one process: every
// module-level cache key must differ between them.
const contexts = {
  acme: { config: { companyDomain: "acme", oauthToken: "tok-acme-1" } },
  globex: { config: { companyDomain: "globex", oauthToken: "tok-globex-1" } },
  globexOther: { config: { companyDomain: "globex", oauthToken: "tok-globex-2" } },
  scoped: { config: { companyDomain: "shared", cacheScope: "https://acme.pipedrive.com:42", apiToken: "api-1" } },
};
let current: keyof typeof contexts = "acme";

vi.mock("../../../src/server.js", () => ({
  getContext: () => contexts[current],
}));

import { accountCacheKey, userCacheKey } from "../../../src/services/cache.js";

beforeEach(() => {
  current = "acme";
});

describe("accountCacheKey", () => {
  it("separates accounts by companyDomain when no cacheScope is set", () => {
    const acme = accountCacheKey("deal");
    current = "globex";
    const globex = accountCacheKey("deal");
    expect(acme).not.toBe(globex);
    expect(acme.endsWith("|deal")).toBe(true);
  });

  it("prefers an explicit cacheScope over companyDomain", () => {
    current = "scoped";
    expect(accountCacheKey("deal")).toBe("https://acme.pipedrive.com:42|deal");
  });

  it("is stable for the same account and key", () => {
    expect(accountCacheKey("deal")).toBe(accountCacheKey("deal"));
  });
});

describe("userCacheKey", () => {
  it("separates two users on the same account", () => {
    current = "globex";
    const first = userCacheKey("me");
    current = "globexOther";
    const second = userCacheKey("me");
    expect(first).not.toBe(second);
    expect(first.startsWith(accountCacheKey("me"))).toBe(true);
  });

  it("falls back to the API token as the user identity", () => {
    current = "scoped";
    expect(userCacheKey("me")).toBe("https://acme.pipedrive.com:42|me|api-1");
  });
});
