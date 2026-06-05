import { describe, it, expect, beforeAll, afterEach } from "vitest";
import nock from "nock";
import { setupTestContext, callTool, BASE_URL } from "../../helpers/setup.js";

beforeAll(async () => {
  await setupTestContext();
});

afterEach(() => {
  nock.cleanAll();
});

describe("pipedrive_product_variations_list", () => {
  it("returns a compact list of variations", async () => {
    nock(BASE_URL)
      .get("/api/v2/products/29/variations")
      .query(true)
      .reply(200, {
        success: true,
        data: [
          {
            id: 2,
            name: "Power (Annual)",
            product_id: 29,
            prices: [{ product_variation_id: 2, price: 5, currency: "USD", cost: 0, direct_cost: 0, notes: "" }],
          },
        ],
        additional_data: { next_cursor: null },
      });

    const { result, data } = await callTool("pipedrive_product_variations_list", { product_id: 29 });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    const items = parsed.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(2);
    expect(items[0].name).toBe("Power (Annual)");
    expect(items[0].product_id).toBe(29);
    expect(items[0].prices).toBeInstanceOf(Array);
    expect(parsed.truncated).toBe(false);
  });
});

describe("pipedrive_product_variations_create", () => {
  it("creates a variation and returns it", async () => {
    nock(BASE_URL)
      .post("/api/v2/products/29/variations", (body) => body.name === "Premium (Annual)")
      .query(true)
      .reply(201, { success: true, data: { id: 3, name: "Premium (Annual)", product_id: 29, prices: [] } });

    const { result, data } = await callTool("pipedrive_product_variations_create", {
      product_id: 29,
      name: "Premium (Annual)",
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    const variation = parsed.variation as Record<string, unknown>;
    expect(variation.id).toBe(3);
    expect(variation.name).toBe("Premium (Annual)");
  });
});

describe("pipedrive_product_variations_update", () => {
  it("updates a variation name", async () => {
    nock(BASE_URL)
      .patch("/api/v2/products/29/variations/3", (body) => body.name === "Premium Plus")
      .query(true)
      .reply(200, { success: true, data: { id: 3, name: "Premium Plus", product_id: 29, prices: [] } });

    const { result, data } = await callTool("pipedrive_product_variations_update", {
      product_id: 29,
      product_variation_id: 3,
      name: "Premium Plus",
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    expect(parsed.message).toContain("3 updated");
  });
});

describe("pipedrive_product_variations_delete", () => {
  it("returns dry run result when dry_run is true", async () => {
    const { result, data } = await callTool("pipedrive_product_variations_delete", {
      product_id: 29,
      product_variation_id: 3,
      confirm: "DELETE",
      dry_run: true,
    });

    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).dry_run).toBe(true);
  });

  it("deletes a variation with confirmation", async () => {
    nock(BASE_URL)
      .delete("/api/v2/products/29/variations/3")
      .query(true)
      .reply(200, { success: true, data: { id: 3 } });

    const { result, data } = await callTool("pipedrive_product_variations_delete", {
      product_id: 29,
      product_variation_id: 3,
      confirm: "DELETE",
    });

    expect(result.isError).toBeFalsy();
    expect((data as Record<string, unknown>).message).toContain("deleted");
  });
});

describe("pipedrive_deal_products_add with variation", () => {
  it("passes product_variation_id through to the API", async () => {
    let sentBody: Record<string, unknown> | undefined;
    nock(BASE_URL)
      .post("/api/v2/deals/117/products", (body) => {
        sentBody = body;
        return body.product_variation_id === 2;
      })
      .query(true)
      .reply(201, { success: true, data: { id: 9001, deal_id: 117, product_id: 29, product_variation_id: 2 } });

    const { result } = await callTool("pipedrive_deal_products_add", {
      deal_id: 117,
      product_id: 29,
      item_price: 5,
      quantity: 1,
      product_variation_id: 2,
    });

    expect(result.isError).toBeFalsy();
    expect(sentBody?.product_variation_id).toBe(2);
  });
});

describe("pipedrive_deal_products_update with variation", () => {
  it("remaps a deal product's variation", async () => {
    let sentBody: Record<string, unknown> | undefined;
    nock(BASE_URL)
      .patch("/api/v2/deals/117/products/9001", (body) => {
        sentBody = body;
        return body.product_variation_id === 7;
      })
      .query(true)
      .reply(200, { success: true, data: { id: 9001, deal_id: 117, product_variation_id: 7 } });

    const { result } = await callTool("pipedrive_deal_products_update", {
      deal_id: 117,
      deal_product_id: 9001,
      product_variation_id: 7,
    });

    expect(result.isError).toBeFalsy();
    expect(sentBody?.product_variation_id).toBe(7);
  });
});

describe("pipedrive_product_deals_list", () => {
  it("lists deals a product is attached to (v1, status filter)", async () => {
    nock(BASE_URL)
      .get("/v1/products/29/deals")
      .query((q) => q.status === "won")
      .reply(200, {
        success: true,
        data: [{ id: 117, title: "Acme subscription", status: "won" }],
        additional_data: { pagination: { start: 0, limit: 25, more_items_in_collection: false } },
      });

    const { result, data } = await callTool("pipedrive_product_deals_list", {
      product_id: 29,
      status: "won",
    });

    expect(result.isError).toBeFalsy();
    const parsed = data as Record<string, unknown>;
    const items = parsed.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(117);
    expect(items[0].status).toBe("won");
    expect(parsed.truncated).toBe(false);
  });
});
