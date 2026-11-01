import { z } from "zod";
import { IdSchema, LimitSchema, PageTokenSchema, SortDirectionSchema } from "./common.js";

export const FiltersListSchema = z.object({
  type: z.enum(["deals", "people", "org", "products", "activity", "leads", "projects"]).optional().describe("Filter entity type"),
}).strict();

export const FiltersGetSchema = z.object({
  filter_id: IdSchema.describe("The filter ID to retrieve"),
}).strict();

// Pipedrive v2 list endpoints accept a different sort_by set per entity; anything else is a 400.
const FILTER_RESULTS_SORT_BY: Record<string, readonly string[]> = {
  deals: ["id", "update_time", "add_time"],
  people: ["id", "update_time", "add_time"],
  org: ["id", "update_time", "add_time"],
  products: ["id", "update_time", "add_time", "name"],
  activity: ["id", "update_time", "add_time", "due_date"],
};

export const FiltersResultsSchema = z.object({
  filter_id: IdSchema.describe("The filter ID to run"),
  entity_type: z.enum(["deals", "people", "org", "products", "activity"]).describe("Entity type the filter applies to"),
  cursor: PageTokenSchema,
  limit: LimitSchema,
  sort_by: z.enum(["id", "update_time", "add_time", "name", "due_date"]).optional()
    .describe("Field to sort by: id, update_time or add_time for any entity; also name for products, due_date for activity"),
  sort_direction: SortDirectionSchema,
}).strict().superRefine((value, ctx) => {
  const allowed = FILTER_RESULTS_SORT_BY[value.entity_type];
  if (value.sort_by !== undefined && !allowed.includes(value.sort_by)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sort_by"],
      message: `sort_by "${value.sort_by}" is not supported for ${value.entity_type}. Use one of: ${allowed.join(", ")}.`,
    });
  }
});
