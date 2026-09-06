import { z } from "zod";
import { IdSchema, LimitSchema, PageTokenSchema } from "./common.js";

const FILE_SCOPE_KEYS = ["deal_id", "person_id", "org_id", "product_id"] as const;

// Pipedrive's account-wide GET /files ignores entity filters, so scoping must go
// through the per-entity sub-resources (/deals/{id}/files etc.). Exactly one scope
// may be given. Leads and activities have no files sub-resource in v1, so those
// two are applied as client-side filters within a scope.
export const FilesListSchema = z.object({
  deal_id: z.coerce.number().int().positive().optional().describe("Scope the listing to this deal's files"),
  person_id: z.coerce.number().int().positive().optional().describe("Scope the listing to this person's files"),
  org_id: z.coerce.number().int().positive().optional().describe("Scope the listing to this organization's files"),
  product_id: z.coerce.number().int().positive().optional().describe("Scope the listing to this product's files"),
  activity_id: z.coerce.number().int().positive().optional().describe("Within a deal/person/org/product scope, only files attached to this activity (Pipedrive has no per-activity files endpoint, so a scope is required)"),
  lead_id: z.string().optional().describe("Within a deal/person/org/product scope, only files attached to this lead (Pipedrive has no per-lead files endpoint, so a scope is required)"),
  cursor: PageTokenSchema,
  limit: LimitSchema,
  sort: z.enum(["id", "name", "add_time", "update_time"]).optional(),
}).strict().superRefine((value, ctx) => {
  const scopes = FILE_SCOPE_KEYS.filter((key) => value[key] !== undefined);
  if (scopes.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [scopes[1]],
      message: `Provide at most one of deal_id, person_id, org_id, product_id (got ${scopes.join(", ")}). Pipedrive lists files per entity.`,
    });
  }
  if (scopes.length === 0 && (value.activity_id !== undefined || value.lead_id !== undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [value.activity_id !== undefined ? "activity_id" : "lead_id"],
      message:
        "Pipedrive has no per-activity or per-lead files endpoint. Supply deal_id, person_id, org_id or product_id as the scope; activity_id and lead_id are then applied as filters within it.",
    });
  }
});

export type FilesListInput = z.infer<typeof FilesListSchema>;

export const FilesGetSchema = z.object({
  file_id: IdSchema.describe("The file ID to retrieve"),
  include_download_url: z.boolean().optional().default(true).describe("Include a temporary download URL"),
}).strict();

export const FilesUploadSchema = z.object({
  file_name: z.string().min(1).describe("File name with extension"),
  content_base64: z.string().min(1).describe("File content as base64-encoded string"),
  deal_id: z.coerce.number().int().positive().optional().describe("Attach to this deal"),
  person_id: z.coerce.number().int().positive().optional().describe("Attach to this person"),
  org_id: z.coerce.number().int().positive().optional().describe("Attach to this organization"),
  product_id: z.coerce.number().int().positive().optional().describe("Attach to this product"),
  activity_id: z.coerce.number().int().positive().optional().describe("Attach to this activity"),
  lead_id: z.string().optional().describe("Attach to this lead"),
  mime_type: z.string().optional().describe("MIME type (auto-detected if omitted)"),
}).strict();
