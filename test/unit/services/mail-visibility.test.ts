import { describe, it, expect } from "vitest";
import { buildVisibilityMeta } from "../../../src/services/mail-visibility.js";

describe("buildVisibilityMeta", () => {
  it("adds a note when fewer messages are visible than counted", () => {
    const meta = buildVisibilityMeta({ entity: "deal", reportedCount: 26, start: 0, itemsReturned: 18, hasMore: false });
    expect(meta).toMatchObject({ reported_count: 26, visible_count: 18 });
    expect(meta.note).toContain("18 of the 26");
    expect(meta.note).toContain("this deal");
  });

  it("has no note when counts match", () => {
    const meta = buildVisibilityMeta({ entity: "person", reportedCount: 6, start: 0, itemsReturned: 6, hasMore: false });
    expect(meta.note).toBeUndefined();
  });

  it("cannot compute visible_count while more pages remain", () => {
    const meta = buildVisibilityMeta({ entity: "deal", reportedCount: 26, start: 25, itemsReturned: 25, hasMore: true });
    expect(meta.visible_count).toBeNull();
    expect(meta.note).toBeUndefined();
  });

  it("tolerates an unknown reported count", () => {
    const meta = buildVisibilityMeta({ entity: "organization", reportedCount: null, start: 0, itemsReturned: 4, hasMore: false });
    expect(meta).toEqual({ reported_count: null, visible_count: 4 });
  });

  it("leaves visible_count null on an empty page past the end of the collection", () => {
    const meta = buildVisibilityMeta({ entity: "deal", reportedCount: 226, start: 200, itemsReturned: 0, hasMore: false });
    expect(meta.visible_count).toBeNull();
    expect(meta.note).toBeUndefined();
  });

  it("still reports zero visible on an empty first page", () => {
    const meta = buildVisibilityMeta({ entity: "deal", reportedCount: 5, start: 0, itemsReturned: 0, hasMore: false });
    expect(meta.visible_count).toBe(0);
    expect(meta.note).toContain("0 of the 5");
  });
});
