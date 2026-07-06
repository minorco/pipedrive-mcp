import { describe, it, expect } from "vitest";
import {
  computeMissingFields,
  isFieldValueEmpty,
  type DealFieldRequirement,
} from "../../../src/services/field-requirements.js";

const NO_RULE = { enabled: false, stageIds: [], statuses: {} };

function field(overrides: Partial<DealFieldRequirement>): DealFieldRequirement {
  return {
    key: "k",
    name: "Field",
    fieldType: "varchar",
    options: null,
    important: NO_RULE,
    required: NO_RULE,
    ...overrides,
  };
}

const CUSTOM_KEY = "f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5";

describe("isFieldValueEmpty", () => {
  it("treats null, undefined, blank strings and empty arrays as empty", () => {
    expect(isFieldValueEmpty(null)).toBe(true);
    expect(isFieldValueEmpty(undefined)).toBe(true);
    expect(isFieldValueEmpty("")).toBe(true);
    expect(isFieldValueEmpty("  ")).toBe(true);
    expect(isFieldValueEmpty([])).toBe(true);
  });

  it("treats populated values as present, including zero", () => {
    expect(isFieldValueEmpty("x")).toBe(false);
    expect(isFieldValueEmpty(0)).toBe(false);
    expect(isFieldValueEmpty([1])).toBe(false);
  });

  it("looks inside monetary-style objects", () => {
    expect(isFieldValueEmpty({ value: null, currency: "USD" })).toBe(true);
    expect(isFieldValueEmpty({ value: 500, currency: "USD" })).toBe(false);
  });
});

describe("computeMissingFields", () => {
  const deal = {
    id: 117,
    stage_id: 1,
    pipeline_id: 1,
    status: "open",
    title: "Acme",
    custom_fields: { [CUSTOM_KEY]: null },
  };

  it("reports a field required at the target stage when empty", () => {
    const fields = [
      field({
        key: CUSTOM_KEY,
        name: "Deal Source",
        fieldType: "enum",
        options: [{ id: 401, label: "Referral" }],
        required: { enabled: true, stageIds: [2], statuses: {} },
      }),
    ];
    const check = computeMissingFields(fields, deal, { stageId: 2 });
    expect(check.required_missing).toHaveLength(1);
    expect(check.required_missing[0].name).toBe("Deal Source");
    expect(check.required_missing[0].options).toEqual([{ id: 401, label: "Referral" }]);
  });

  it("does not report a stage-scoped requirement at other stages", () => {
    const fields = [
      field({ key: CUSTOM_KEY, required: { enabled: true, stageIds: [2], statuses: {} } }),
    ];
    const check = computeMissingFields(fields, deal, { stageId: 3 });
    expect(check.required_missing).toHaveLength(0);
  });

  it("treats enabled with no stage list and no statuses as required everywhere", () => {
    const fields = [
      field({ key: CUSTOM_KEY, required: { enabled: true, stageIds: [], statuses: {} } }),
    ];
    const check = computeMissingFields(fields, deal, { stageId: 3 });
    expect(check.required_missing).toHaveLength(1);
  });

  it("does not treat a status-only rule as required at every stage", () => {
    const fields = [
      field({
        key: CUSTOM_KEY,
        required: { enabled: true, stageIds: [], statuses: { "1": ["lost"] } },
      }),
    ];
    const check = computeMissingFields(fields, deal, { stageId: 3 });
    expect(check.required_missing).toHaveLength(0);
  });

  it("applies status rules for the deal's pipeline", () => {
    const fields = [
      field({
        key: CUSTOM_KEY,
        name: "Loss Reason Detail",
        required: { enabled: true, stageIds: [], statuses: { "1": ["lost"] } },
      }),
    ];
    const lost = computeMissingFields(fields, { ...deal, status: "lost" }, {});
    expect(lost.required_missing.map((f) => f.name)).toEqual(["Loss Reason Detail"]);

    const lostOtherPipeline = computeMissingFields(
      fields,
      { ...deal, pipeline_id: 2, status: "lost" },
      {},
    );
    expect(lostOtherPipeline.required_missing).toHaveLength(0);
  });

  it("reports important fields separately", () => {
    const fields = [
      field({
        key: CUSTOM_KEY,
        name: "Budget",
        important: { enabled: true, stageIds: [2], statuses: {} },
      }),
    ];
    const check = computeMissingFields(fields, deal, { stageId: 2 });
    expect(check.required_missing).toHaveLength(0);
    expect(check.important_missing.map((f) => f.name)).toEqual(["Budget"]);
  });

  it("skips populated fields, checking custom_fields and top-level keys", () => {
    const fields = [
      field({ key: CUSTOM_KEY, required: { enabled: true, stageIds: [], statuses: {} } }),
      field({ key: "title", name: "Title", required: { enabled: true, stageIds: [], statuses: {} } }),
    ];
    const populated = {
      ...deal,
      custom_fields: { [CUSTOM_KEY]: 401 },
    };
    const check = computeMissingFields(fields, populated, {});
    expect(check.required_missing).toHaveLength(0);
  });
});
