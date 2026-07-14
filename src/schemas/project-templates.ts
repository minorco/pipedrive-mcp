import { z } from "zod";
import { IdSchema, LimitSchema, PageTokenSchema } from "./common.js";

// Project templates (BETA API, Projects add-on). Read-only surface; templates
// are created in the Pipedrive UI and consumed via pipedrive_projects_create
// with template_id.

export const ProjectTemplatesListSchema = z.object({
  cursor: PageTokenSchema,
  limit: LimitSchema,
}).strict();

export const ProjectTemplatesGetSchema = z.object({
  template_id: IdSchema.describe("The project template ID to retrieve"),
}).strict();
