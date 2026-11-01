import { describe, it, expect } from "vitest";
import { DealsListSchema } from "../../../src/schemas/deals.js";
import { OrganizationsListSchema } from "../../../src/schemas/organizations.js";
import { PersonsListSchema } from "../../../src/schemas/persons.js";
import { FiltersResultsSchema } from "../../../src/schemas/filters.js";
import { DealProductsListSchema } from "../../../src/schemas/products.js";

// Regression coverage for the Pipedrive 400 "sort_by: The value you selected is not a valid choice"
// errors. v2 list endpoints for deals, orgs, and persons only accept id / update_time / add_time;
// the schemas previously allowed title, value, and name which Pipedrive rejects.

describe("Deals list sort_by", () => {
  it("accepts documented values and rejects undocumented ones", () => {
    expect(DealsListSchema.safeParse({ sort_by: "id" }).success).toBe(true);
    expect(DealsListSchema.safeParse({ sort_by: "update_time" }).success).toBe(true);
    expect(DealsListSchema.safeParse({ sort_by: "add_time" }).success).toBe(true);
    expect(DealsListSchema.safeParse({ sort_by: "title" }).success).toBe(false);
    expect(DealsListSchema.safeParse({ sort_by: "value" }).success).toBe(false);
  });
});

describe("Organizations list sort_by", () => {
  it("accepts documented values and rejects 'name' (not v2-supported)", () => {
    expect(OrganizationsListSchema.safeParse({ sort_by: "id" }).success).toBe(true);
    expect(OrganizationsListSchema.safeParse({ sort_by: "name" }).success).toBe(false);
  });
});

describe("Persons list sort_by", () => {
  it("accepts documented values and rejects 'name' (not v2-supported)", () => {
    expect(PersonsListSchema.safeParse({ sort_by: "id" }).success).toBe(true);
    expect(PersonsListSchema.safeParse({ sort_by: "name" }).success).toBe(false);
  });
});

describe("Filters results sort_by", () => {
  it("accepts the values each entity's v2 list endpoint supports", () => {
    expect(FiltersResultsSchema.safeParse({ filter_id: 1, entity_type: "deals", sort_by: "update_time" }).success).toBe(true);
    expect(FiltersResultsSchema.safeParse({ filter_id: 1, entity_type: "products", sort_by: "name" }).success).toBe(true);
    expect(FiltersResultsSchema.safeParse({ filter_id: 1, entity_type: "activity", sort_by: "due_date" }).success).toBe(true);
  });

  it("rejects free text and values from another entity", () => {
    expect(FiltersResultsSchema.safeParse({ filter_id: 1, entity_type: "deals", sort_by: "title" }).success).toBe(false);
    expect(FiltersResultsSchema.safeParse({ filter_id: 1, entity_type: "deals", sort_by: "name" }).success).toBe(false);
    expect(FiltersResultsSchema.safeParse({ filter_id: 1, entity_type: "people", sort_by: "due_date" }).success).toBe(false);
  });
});

describe("Deal products list sort_by", () => {
  it("accepts documented values and rejects undocumented ones", () => {
    expect(DealProductsListSchema.safeParse({ deal_id: 1, sort_by: "order_nr" }).success).toBe(true);
    expect(DealProductsListSchema.safeParse({ deal_id: 1, sort_by: "name" }).success).toBe(false);
  });
});
