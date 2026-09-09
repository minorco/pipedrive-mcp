import { describe, it, expect } from "vitest";
import { AddressSchema } from "../../../src/schemas/common.js";
import { OrganizationsCreateSchema, OrganizationsUpdateSchema } from "../../../src/schemas/organizations.js";
import { ActivitiesCreateSchema, ActivitiesUpdateSchema } from "../../../src/schemas/activities.js";
import { zodToJsonSchema } from "../../../src/schemas/zod-to-json.js";

describe("AddressSchema (v2 address objects)", () => {
  it("coerces a plain string into { value }", () => {
    expect(AddressSchema.parse("123 Queen St, Auckland")).toEqual({ value: "123 Queen St, Auckland" });
  });

  it("passes a structured address through unchanged", () => {
    const addr = { value: "1 Main Rd", locality: "Wellington", country: "New Zealand", postal_code: "6011" };
    expect(AddressSchema.parse(addr)).toEqual(addr);
  });

  it("rejects unknown address components", () => {
    expect(AddressSchema.safeParse({ value: "x", city: "nope" }).success).toBe(false);
  });

  it("is optional", () => {
    expect(AddressSchema.parse(undefined)).toBeUndefined();
  });

  it("is wired into organization address and activity location", () => {
    expect(OrganizationsCreateSchema.parse({ name: "Acme", address: "Somewhere" }).address).toEqual({ value: "Somewhere" });
    expect(OrganizationsUpdateSchema.parse({ org_id: 1, address: { locality: "Auckland" } }).address).toEqual({ locality: "Auckland" });
    expect(ActivitiesCreateSchema.parse({ subject: "Call", type: "call", location: "Cafe" }).location).toEqual({ value: "Cafe" });
    expect(ActivitiesUpdateSchema.parse({ activity_id: 1, location: { value: "Office", country: "NZ" } }).location).toEqual({ value: "Office", country: "NZ" });
  });

  it("publishes both shapes in the JSON Schema", () => {
    const json = zodToJsonSchema(OrganizationsCreateSchema) as { properties: Record<string, { anyOf?: unknown[] }> };
    expect(json.properties.address.anyOf).toHaveLength(2);
  });
});
