import { describe, it, expect } from "vitest";
import { PageTokenSchema } from "../../../src/schemas/common.js";
import { DealsListSchema } from "../../../src/schemas/deals.js";
import { PersonsListSchema } from "../../../src/schemas/persons.js";
import { OrganizationsListSchema } from "../../../src/schemas/organizations.js";
import { ProductsListSchema } from "../../../src/schemas/products.js";

const listSchemas = [
  ["DealsListSchema", DealsListSchema],
  ["PersonsListSchema", PersonsListSchema],
  ["OrganizationsListSchema", OrganizationsListSchema],
  ["ProductsListSchema", ProductsListSchema],
] as const;

describe("ids filter limit", () => {
  const hundredIds = Array.from({ length: 100 }, (_, i) => i + 1);
  const tooManyIds = Array.from({ length: 101 }, (_, i) => i + 1);

  for (const [name, schema] of listSchemas) {
    it(`${name} accepts 100 ids`, () => {
      expect(schema.safeParse({ ids: hundredIds }).success).toBe(true);
    });

    it(`${name} rejects 101 ids with batching guidance`, () => {
      const result = schema.safeParse({ ids: tooManyIds });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("100");
        expect(result.error.message).toMatch(/batch/i);
      }
    });
  }
});

describe("PageTokenSchema format", () => {
  it("accepts cursor tokens", () => {
    expect(PageTokenSchema.safeParse("cursor:abc123").success).toBe(true);
  });

  it("accepts offset tokens", () => {
    expect(PageTokenSchema.safeParse("offset:50").success).toBe(true);
  });

  it("accepts cursor values containing colons", () => {
    expect(PageTokenSchema.safeParse("cursor:eyJ0eXAi:Oixx").success).toBe(true);
  });

  it("accepts undefined (no token)", () => {
    expect(PageTokenSchema.safeParse(undefined).success).toBe(true);
  });

  it("rejects a bare number with guidance to use next_page_token", () => {
    const result = PageTokenSchema.safeParse("100");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("next_page_token");
    }
  });

  it("rejects arbitrary strings", () => {
    expect(PageTokenSchema.safeParse("page2").success).toBe(false);
  });

  it("rejects unknown prefixes", () => {
    expect(PageTokenSchema.safeParse("badmode:123").success).toBe(false);
  });
});
