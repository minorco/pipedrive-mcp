import { describe, it, expect } from "vitest";
import { DealsCreateSchema, DealsUpdateSchema } from "../../../src/schemas/deals.js";
import { LeadsCreateSchema } from "../../../src/schemas/leads.js";
import {
  ProductsCreateSchema,
  DealProductsAddSchema,
  DealProductsUpdateSchema,
} from "../../../src/schemas/products.js";

// Regression coverage for the issue #18 class of bug: some MCP clients (notably
// certain Claude Desktop builds) serialise numeric tool arguments as strings.
// IDs were already coerced via IdSchema; this extends the same defence to the
// monetary and quantity fields on write tools, which were strict z.number().

describe("Deal value coercion", () => {
  it("update_deal coerces a string value to a number", () => {
    const r = DealsUpdateSchema.parse({ deal_id: "439", value: "5000" });
    expect(r.value).toBe(5000);
    expect(typeof r.value).toBe("number");
  });

  it("create_deal coerces a string value to a number", () => {
    const r = DealsCreateSchema.parse({ title: "x", value: "5000" });
    expect(r.value).toBe(5000);
  });

  it("still accepts a real number", () => {
    expect(DealsUpdateSchema.parse({ deal_id: 439, value: 5000 }).value).toBe(5000);
  });

  it("rejects a non-numeric string", () => {
    expect(DealsUpdateSchema.safeParse({ deal_id: 439, value: "abc" }).success).toBe(false);
  });
});

describe("Lead value.amount coercion", () => {
  it("coerces a string amount to a number", () => {
    const r = LeadsCreateSchema.parse({
      title: "x",
      value: { amount: "2500", currency: "USD" },
    });
    expect(r.value?.amount).toBe(2500);
  });
});

describe("Product and deal-product numeric coercion", () => {
  it("create_product coerces string tax and nested price/cost", () => {
    const r = ProductsCreateSchema.parse({
      name: "Widget",
      tax: "10",
      prices: [{ price: "199.99", currency: "USD", cost: "50" }],
    });
    expect(r.tax).toBe(10);
    expect(r.prices?.[0].price).toBe(199.99);
    expect(r.prices?.[0].cost).toBe(50);
  });

  it("add_deal_product coerces string item_price, quantity and discount", () => {
    const r = DealProductsAddSchema.parse({
      deal_id: "439",
      product_id: "12",
      item_price: "199.99",
      quantity: "3",
      discount: "10",
    });
    expect(r.item_price).toBe(199.99);
    expect(r.quantity).toBe(3);
    expect(r.discount).toBe(10);
  });

  it("update_deal_product coerces string item_price and quantity", () => {
    const r = DealProductsUpdateSchema.parse({
      deal_id: "439",
      deal_product_id: "7",
      item_price: "250",
      quantity: "2",
    });
    expect(r.item_price).toBe(250);
    expect(r.quantity).toBe(2);
  });
});
