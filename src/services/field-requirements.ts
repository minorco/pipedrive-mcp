import { TtlCache } from "./cache.js";
import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { log } from "../logging.js";
import type { FieldOption } from "./custom-fields.js";

export interface FieldRequirementRule {
  enabled: boolean;
  stageIds: number[];
  // Pipeline ID (as string) -> statuses ("won"/"lost") the field is required for
  statuses: Record<string, string[]>;
}

export interface DealFieldRequirement {
  key: string;
  name: string;
  fieldType: string;
  options: FieldOption[] | null;
  important: FieldRequirementRule;
  required: FieldRequirementRule;
}

export interface MissingField {
  key: string;
  name: string;
  field_type: string;
  options?: FieldOption[];
}

export interface FieldRequirementsCheck {
  stage_id: number | null;
  required_missing: MissingField[];
  important_missing: MissingField[];
  note?: string;
}

export const FIELD_REQUIREMENTS_NOTE =
  "Pipedrive marks these fields as required/important for this stage in the web UI, but the API does not enforce them. " +
  "Populate them via pipedrive_deals_update: pick from options for dropdown fields; ask the user for values you cannot infer.";

let requirementsCache: TtlCache<DealFieldRequirement[]> | null = null;
const CACHE_KEY = "deal";

function getCache(): TtlCache<DealFieldRequirement[]> {
  if (!requirementsCache) {
    const { config } = getContext();
    requirementsCache = new TtlCache<DealFieldRequirement[]>(config.fieldCacheTtlMs);
  }
  return requirementsCache;
}

function parseRule(raw: unknown): FieldRequirementRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    stageIds: Array.isArray(r.stage_ids) ? (r.stage_ids as number[]) : [],
    statuses:
      r.statuses && typeof r.statuses === "object"
        ? (r.statuses as Record<string, string[]>)
        : {},
  };
}

/**
 * Fetch deal field requirement config from v2 dealFields. Unlike the other
 * field metadata (v1, see custom-fields.ts), required/important flags only
 * exist on the v2 fields endpoint, which is not available on every instance -
 * returns null when the config cannot be fetched, and callers degrade to no check.
 */
export async function getDealFieldRequirements(): Promise<DealFieldRequirement[] | null> {
  const cache = getCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  const { apiV2, rateLimiters } = getContext();
  const fields: DealFieldRequirement[] = [];
  let cursor: string | undefined;

  try {
    do {
      const response = await rateLimiters.general.schedule(() =>
        withRetry(
          () =>
            apiV2.list<Record<string, unknown>>("/dealFields", {
              include_fields: "important_fields,required_fields",
              limit: 500,
              cursor,
            }),
          { label: "GET /dealFields (requirements)" },
        ),
      );

      if (response.status !== 200) {
        log.warn(`Field requirements unavailable: GET /api/v2/dealFields returned ${response.status}`);
        return null;
      }

      for (const raw of response.data.data ?? []) {
        const rawOptions = raw.options as Array<{ id: number; label: string }> | undefined;
        fields.push({
          key: (raw.field_code as string) ?? (raw.key as string),
          // v2 dealFields uses field_name (v1 uses name)
          name: (raw.field_name as string) ?? (raw.name as string) ?? "",
          fieldType: (raw.field_type as string) ?? "unknown",
          options: Array.isArray(rawOptions)
            ? rawOptions.map((o) => ({ id: o.id, label: o.label }))
            : null,
          important: parseRule(raw.important_fields),
          required: parseRule(raw.required_fields),
        });
      }
      cursor = response.data.additional_data?.next_cursor ?? undefined;
    } while (cursor);
  } catch (err) {
    log.warn(`Field requirements unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  cache.set(CACHE_KEY, fields);
  return fields;
}

export function isFieldValueEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    // Monetary/range custom fields come back as objects with a `value` member
    const v = value as Record<string, unknown>;
    if ("value" in v) return v.value === null || v.value === undefined;
  }
  return false;
}

function ruleAppliesAtStage(rule: FieldRequirementRule, stageId: number | null): boolean {
  if (!rule.enabled) return false;
  if (rule.stageIds.length > 0) return stageId !== null && rule.stageIds.includes(stageId);
  // Enabled with no stage list means required everywhere - unless the rule is
  // status-only (statuses set, no stages), which must not fire on stage checks.
  return Object.keys(rule.statuses).length === 0;
}

function ruleAppliesForStatus(
  rule: FieldRequirementRule,
  pipelineId: number | null,
  status: string | null,
): boolean {
  if (!rule.enabled) return false;
  if (status !== "won" && status !== "lost") return false;
  if (pipelineId === null) return false;
  const statuses = rule.statuses[String(pipelineId)];
  return Array.isArray(statuses) && statuses.includes(status);
}

function dealFieldValue(deal: Record<string, unknown>, key: string): unknown {
  const customFields = deal.custom_fields as Record<string, unknown> | undefined;
  if (customFields && key in customFields) return customFields[key];
  return deal[key];
}

export function computeMissingFields(
  fields: DealFieldRequirement[],
  deal: Record<string, unknown>,
  target: { stageId?: number; status?: string },
): FieldRequirementsCheck {
  const stageId = target.stageId ?? (deal.stage_id as number | undefined) ?? null;
  const pipelineId = (deal.pipeline_id as number | undefined) ?? null;
  const status = target.status ?? (deal.status as string | undefined) ?? null;

  const required_missing: MissingField[] = [];
  const important_missing: MissingField[] = [];

  for (const field of fields) {
    if (!isFieldValueEmpty(dealFieldValue(deal, field.key))) continue;

    const entry: MissingField = {
      key: field.key,
      name: field.name,
      field_type: field.fieldType,
      ...(field.options ? { options: field.options } : {}),
    };

    if (
      ruleAppliesAtStage(field.required, stageId) ||
      ruleAppliesForStatus(field.required, pipelineId, status)
    ) {
      required_missing.push(entry);
    } else if (ruleAppliesAtStage(field.important, stageId)) {
      important_missing.push(entry);
    }
  }

  return { stage_id: stageId, required_missing, important_missing };
}

/**
 * Convenience wrapper for tool handlers. Returns:
 * - null when requirement config is unavailable (degrade silently on writes)
 * - a check (possibly with empty lists) when config was fetched
 */
export async function checkDealFieldRequirements(
  deal: Record<string, unknown>,
  target: { stageId?: number; status?: string },
): Promise<FieldRequirementsCheck | null> {
  const fields = await getDealFieldRequirements();
  if (!fields) return null;
  const check = computeMissingFields(fields, deal, target);
  if (check.required_missing.length > 0 || check.important_missing.length > 0) {
    check.note = FIELD_REQUIREMENTS_NOTE;
  }
  return check;
}

export function hasMissingFields(check: FieldRequirementsCheck | null): check is FieldRequirementsCheck {
  return !!check && (check.required_missing.length > 0 || check.important_missing.length > 0);
}

export function clearFieldRequirementsCache(): void {
  requirementsCache?.clear();
}
