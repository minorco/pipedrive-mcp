import { describe, it, expect } from "vitest";
import { SearchTermSchema } from "../../../src/schemas/common.js";
import { DealsSearchSchema } from "../../../src/schemas/deals.js";
import { PersonsSearchSchema } from "../../../src/schemas/persons.js";
import { OrganizationsSearchSchema } from "../../../src/schemas/organizations.js";
import { ProductsSearchSchema } from "../../../src/schemas/products.js";
import { LeadsSearchSchema } from "../../../src/schemas/leads.js";
import { ProjectsSearchSchema } from "../../../src/schemas/projects.js";
import { zodToJsonSchema } from "../../../src/schemas/zod-to-json.js";

const searchSchemas = [
  ["DealsSearchSchema", DealsSearchSchema],
  ["PersonsSearchSchema", PersonsSearchSchema],
  ["OrganizationsSearchSchema", OrganizationsSearchSchema],
  ["ProductsSearchSchema", ProductsSearchSchema],
  ["LeadsSearchSchema", LeadsSearchSchema],
  ["ProjectsSearchSchema", ProjectsSearchSchema],
] as const;

describe("search term minimum length (Pipedrive requires >= 2 characters)", () => {
  for (const [name, schema] of searchSchemas) {
    it(`${name} rejects a 1-character term before the API call`, () => {
      const result = schema.safeParse({ term: "a" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.message).toContain("2 characters");
    });

    it(`${name} rejects a term that is only whitespace padding around 1 character`, () => {
      expect(schema.safeParse({ term: " a " }).success).toBe(false);
    });

    it(`${name} accepts a 2-character term`, () => {
      expect(schema.safeParse({ term: "ab" }).success).toBe(true);
    });

    it(`${name} publishes minLength 2 in its JSON Schema`, () => {
      const json = zodToJsonSchema(schema) as { properties: Record<string, { minLength?: number }> };
      expect(json.properties.term.minLength).toBe(2);
    });
  }

  it("SearchTermSchema trims surrounding whitespace", () => {
    expect(SearchTermSchema.parse("  hello  ")).toBe("hello");
  });
});
