import { z } from "zod";
import {
  IdSchema,
  LimitSchema,
  PageTokenSchema,
  SearchLimitSchema,
  ConfirmDeleteSchema,
  DryRunSchema,
  ReasonSchema,
  FilterIdSchema,
  CustomFieldsSchema,
  CustomFieldsByNameSchema,
} from "./common.js";

// Pipedrive Projects (BETA API, paid add-on). Status values per the v2 docs.
const ProjectStatusSchema = z
  .enum(["open", "completed", "canceled", "deleted"])
  .optional()
  .describe("Filter by project status");

export const ProjectsListSchema = z.object({
  archived_only: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, list archived projects instead of active ones"),
  filter_id: FilterIdSchema,
  status: ProjectStatusSchema,
  phase_id: z.coerce.number().int().positive().optional().describe("Filter by project phase ID"),
  deal_id: z.coerce.number().int().positive().optional().describe("Filter by linked deal ID (active projects only)"),
  person_id: z.coerce.number().int().positive().optional().describe("Filter by linked person ID (active projects only)"),
  org_id: z.coerce.number().int().positive().optional().describe("Filter by linked organization ID (active projects only)"),
  cursor: PageTokenSchema,
  limit: LimitSchema,
}).strict();

export const ProjectsGetSchema = z.object({
  project_id: IdSchema.describe("The project ID to retrieve"),
}).strict();

export const ProjectsSearchSchema = z.object({
  term: z.string().min(2).describe("Search term (min 2 characters)"),
  fields: z
    .enum(["custom_fields", "notes", "title", "description"])
    .optional()
    .describe("Restrict the search to a single field"),
  exact_match: z.boolean().optional().describe("Only exact matches"),
  person_id: z.coerce.number().int().positive().optional().describe("Only projects linked to this person"),
  organization_id: z.coerce.number().int().positive().optional().describe("Only projects linked to this organization"),
  cursor: PageTokenSchema,
  limit: SearchLimitSchema,
}).strict();

const projectWriteFields = {
  description: z.string().optional().describe("Project description"),
  status: ProjectStatusSchema.describe("Project status"),
  board_id: z.coerce.number().int().positive().optional().describe("Project board ID"),
  phase_id: z.coerce.number().int().positive().optional().describe("Project phase ID"),
  owner_id: z.coerce.number().int().positive().optional().describe("Owner user ID"),
  start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
  end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
  deal_ids: z.array(z.coerce.number().int().positive()).optional().describe("Linked deal IDs"),
  person_ids: z.array(z.coerce.number().int().positive()).optional().describe("Linked person IDs"),
  org_ids: z.array(z.coerce.number().int().positive()).optional().describe("Linked organization IDs"),
  label_ids: z.array(z.coerce.number().int().positive()).optional().describe("Project label IDs"),
  health_status: z.coerce.number().int().optional().describe("Project health status"),
  custom_fields: CustomFieldsSchema,
  custom_fields_by_name: CustomFieldsByNameSchema,
};

export const ProjectsCreateSchema = z.object({
  title: z.string().min(1).describe("Project title"),
  template_id: z.coerce.number().int().positive().optional().describe("Project template ID to create from (see pipedrive_project_templates_list)"),
  ...projectWriteFields,
}).strict();

export const ProjectsUpdateSchema = z.object({
  project_id: IdSchema.describe("The project ID to update"),
  title: z.string().min(1).optional().describe("Project title"),
  ...projectWriteFields,
}).strict();

export const ProjectsDeleteSchema = z.object({
  project_id: IdSchema.describe("The project ID to delete"),
  confirm: ConfirmDeleteSchema,
  dry_run: DryRunSchema,
  reason: ReasonSchema,
}).strict();

export const ProjectsArchiveSchema = z.object({
  project_id: IdSchema.describe("The project ID to archive"),
}).strict();

export const ProjectsChangelogSchema = z.object({
  project_id: IdSchema.describe("The project ID"),
  cursor: PageTokenSchema,
  limit: LimitSchema,
}).strict();

export const ProjectsPermittedUsersSchema = z.object({
  project_id: IdSchema.describe("The project ID"),
}).strict();

export const ProjectActivitiesListSchema = z.object({
  project_id: IdSchema.describe("The project ID"),
}).strict();

export const ProjectGroupsListSchema = z.object({
  project_id: IdSchema.describe("The project ID"),
}).strict();

export const ProjectPlanGetSchema = z.object({
  project_id: IdSchema.describe("The project ID"),
}).strict();

export const ProjectPlanUpdateSchema = z.object({
  project_id: IdSchema.describe("The project ID"),
  item_type: z.enum(["activity", "task"]).describe("Whether the plan item is an activity or a project task"),
  item_id: IdSchema.describe("The activity or task ID within the project plan"),
  phase_id: z.coerce.number().int().positive().optional().describe("Phase to assign the item to (omit to leave unchanged)"),
  group_id: z.coerce.number().int().positive().optional().describe("Group to assign the item to (omit to leave unchanged)"),
}).strict();
