import { registerTools, type ToolDefinition } from "../mcp/register-tools.js";
import { successResult, paginatedResult, type ToolResult } from "../mcp/tool-result.js";
import { apiErrorResult, validationErrorResult, guardErrorResult } from "../mcp/errors.js";
import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { normalizeProjectsApiError } from "../services/projects-errors.js";
import { buildPaginationParams, buildPaginatedResult } from "../pipedrive/pagination.js";
import { compactProject } from "../presenters/entities.js";
import { validateConfirmation, buildDryRunResult } from "../services/guards.js";
import {
  resolveCustomFieldsByKey,
  resolveCustomFieldsByName,
  resolveCustomFieldsInResponse,
} from "../services/custom-fields.js";
import {
  ProjectsListSchema,
  ProjectsGetSchema,
  ProjectsSearchSchema,
  ProjectsCreateSchema,
  ProjectsUpdateSchema,
  ProjectsDeleteSchema,
  ProjectsArchiveSchema,
  ProjectsChangelogSchema,
  ProjectsPermittedUsersSchema,
  ProjectActivitiesListSchema,
  ProjectGroupsListSchema,
  ProjectPlanGetSchema,
  ProjectPlanUpdateSchema,
} from "../schemas/projects.js";
import { zodToJsonSchema } from "../schemas/zod-to-json.js";

type ProjectWriteInput = {
  description?: string;
  status?: string;
  board_id?: number;
  phase_id?: number;
  owner_id?: number;
  start_date?: string;
  end_date?: string;
  deal_ids?: number[];
  person_ids?: number[];
  org_ids?: number[];
  label_ids?: number[];
  health_status?: number;
  custom_fields?: Record<string, unknown>;
  custom_fields_by_name?: Record<string, unknown>;
};

// Shared body builder for create/update. Returns an error string when custom
// field resolution fails so the caller can surface it as a validation error.
async function buildProjectBody(input: ProjectWriteInput): Promise<{ body: Record<string, unknown>; error?: string }> {
  const body: Record<string, unknown> = {};
  if (input.description !== undefined) body.description = input.description;
  if (input.status) body.status = input.status;
  if (input.board_id) body.board_id = input.board_id;
  if (input.phase_id) body.phase_id = input.phase_id;
  if (input.owner_id) body.owner_id = input.owner_id;
  if (input.start_date) body.start_date = input.start_date;
  if (input.end_date) body.end_date = input.end_date;
  if (input.deal_ids) body.deal_ids = input.deal_ids;
  if (input.person_ids) body.person_ids = input.person_ids;
  if (input.org_ids) body.org_ids = input.org_ids;
  if (input.label_ids) body.label_ids = input.label_ids;
  if (input.health_status !== undefined) body.health_status = input.health_status;

  // v2 API expects custom fields in a nested `custom_fields` object
  const customFieldsObj: Record<string, unknown> = {};
  if (input.custom_fields) {
    const { resolved, errors } = await resolveCustomFieldsByKey("project", input.custom_fields);
    if (errors.length > 0) return { body, error: errors.join("; ") };
    Object.assign(customFieldsObj, resolved);
  }
  if (input.custom_fields_by_name) {
    const { resolved, errors } = await resolveCustomFieldsByName("project", input.custom_fields_by_name);
    if (errors.length > 0) return { body, error: errors.join("; ") };
    Object.assign(customFieldsObj, resolved);
  }
  if (Object.keys(customFieldsObj).length > 0) {
    body.custom_fields = customFieldsObj;
  }

  return { body };
}

async function handleProjectsList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsListSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_list", parsed.error.message);

  const { apiV2, rateLimiters, config } = getContext();
  const input = parsed.data;
  const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);
  const paginationParams = buildPaginationParams("cursor", limit, input.cursor);
  const path = input.archived_only ? "/projects/archived" : "/projects";

  const params: Record<string, string | number | boolean | undefined> = { ...paginationParams };
  if (input.filter_id) params.filter_id = input.filter_id;
  if (input.status) params.status = input.status;
  if (input.phase_id) params.phase_id = input.phase_id;
  // deal/person/org filters exist on the active-projects endpoint only
  if (!input.archived_only) {
    if (input.deal_id) params.deal_id = input.deal_id;
    if (input.person_id) params.person_id = input.person_id;
    if (input.org_id) params.org_id = input.org_id;
  }

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>(path, params), { label: "pipedrive_projects_list" }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_list", `GET ${path}`));

  const items = response.data.data ?? [];
  const result = buildPaginatedResult(items, "cursor", response.data as unknown as Record<string, unknown>);
  return paginatedResult({ items: result.items.map(compactProject), next_page_token: result.next_page_token, approx_count: result.approx_count, truncated: result.truncated, pagination_mode: result.pagination_mode });
}

async function handleProjectsGet(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsGetSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_get", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.get<Record<string, unknown>>(`/projects/${parsed.data.project_id}`), { label: `pipedrive_projects_get ${parsed.data.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_get", `GET /projects/${parsed.data.project_id}`));

  const project = response.data.data;
  const customFields = await resolveCustomFieldsInResponse("project", project);
  const compact = compactProject(project);

  return successResult({
    ...compact,
    custom_fields_resolved: customFields.length > 0 ? customFields : undefined,
    _raw: project,
  });
}

async function handleProjectsSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsSearchSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_search", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;
  const limit = Math.min(input.limit ?? 10, 50);
  const paginationParams = buildPaginationParams("cursor", limit, input.cursor);

  const params: Record<string, string | number | boolean | undefined> = {
    term: input.term,
    ...paginationParams,
  };
  if (input.fields) params.fields = input.fields;
  if (input.exact_match !== undefined) params.exact_match = input.exact_match;
  if (input.person_id) params.person_id = input.person_id;
  if (input.organization_id) params.organization_id = input.organization_id;

  const response = await rateLimiters.search.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>("/projects/search", params), { label: "pipedrive_projects_search" }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_search", "GET /projects/search"));

  const items = response.data.data ?? [];
  const result = buildPaginatedResult(items, "cursor", response.data as unknown as Record<string, unknown>);
  return paginatedResult({ items: result.items, next_page_token: result.next_page_token, approx_count: result.approx_count, truncated: result.truncated, pagination_mode: result.pagination_mode });
}

async function handleProjectsCreate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsCreateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_create", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;

  const { body, error } = await buildProjectBody(input);
  if (error) return validationErrorResult("pipedrive_projects_create", error);
  body.title = input.title;
  if (input.template_id) body.template_id = input.template_id;

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.post<Record<string, unknown>>("/projects", body), { label: "pipedrive_projects_create" }),
  );

  if (response.status !== 200 && response.status !== 201) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_create", "POST /projects"));
  return successResult({ message: "Project created", project: compactProject(response.data.data) });
}

async function handleProjectsUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsUpdateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_update", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;

  const { body, error } = await buildProjectBody(input);
  if (error) return validationErrorResult("pipedrive_projects_update", error);
  if (input.title) body.title = input.title;

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.patch<Record<string, unknown>>(`/projects/${input.project_id}`, body), { label: `pipedrive_projects_update ${input.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_update", `PATCH /projects/${input.project_id}`));
  return successResult({ message: `Project ${input.project_id} updated`, project: compactProject(response.data.data) });
}

async function handleProjectsDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsDeleteSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_delete", parsed.error.message);

  const input = parsed.data;
  if (input.dry_run) return successResult(buildDryRunResult("pipedrive_projects_delete", "delete", { project_id: input.project_id }, `Would delete project ${input.project_id}`));

  const confirmError = validateConfirmation(input.confirm, "DELETE", "pipedrive_projects_delete", "delete project");
  if (confirmError) return guardErrorResult(confirmError);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.del(`/projects/${input.project_id}`), { label: `pipedrive_projects_delete ${input.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_delete", `DELETE /projects/${input.project_id}`));
  return successResult({ message: `Project ${input.project_id} deleted` });
}

async function handleProjectsArchive(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsArchiveSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_archive", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.post<Record<string, unknown>>(`/projects/${parsed.data.project_id}/archive`, {}), { label: `pipedrive_projects_archive ${parsed.data.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_archive", `POST /projects/${parsed.data.project_id}/archive`));
  return successResult({ message: `Project ${parsed.data.project_id} archived`, project: compactProject(response.data.data) });
}

async function handleProjectsChangelog(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsChangelogSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_changelog", parsed.error.message);

  const { apiV2, rateLimiters, config } = getContext();
  const input = parsed.data;
  const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);
  const paginationParams = buildPaginationParams("cursor", limit, input.cursor);

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>(`/projects/${input.project_id}/changelog`, paginationParams), { label: `pipedrive_projects_changelog ${input.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_changelog", `GET /projects/${input.project_id}/changelog`));

  const items = response.data.data ?? [];
  const result = buildPaginatedResult(items, "cursor", response.data as unknown as Record<string, unknown>);
  return paginatedResult({ items: result.items, next_page_token: result.next_page_token, approx_count: result.approx_count, truncated: result.truncated, pagination_mode: result.pagination_mode });
}

async function handleProjectsPermittedUsers(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectsPermittedUsersSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_projects_permitted_users", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>(`/projects/${parsed.data.project_id}/permittedUsers`), { label: `pipedrive_projects_permitted_users ${parsed.data.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_projects_permitted_users", `GET /projects/${parsed.data.project_id}/permittedUsers`));
  return successResult({ project_id: parsed.data.project_id, permitted_users: response.data.data ?? [] });
}

async function handleProjectActivitiesList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectActivitiesListSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_activities_list", parsed.error.message);

  const { apiV1, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.list<Record<string, unknown>>(`/projects/${parsed.data.project_id}/activities`), { label: `pipedrive_project_activities_list ${parsed.data.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_activities_list", `GET /projects/${parsed.data.project_id}/activities`));
  return successResult({ project_id: parsed.data.project_id, activities: response.data.data ?? [] });
}

async function handleProjectGroupsList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectGroupsListSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_groups_list", parsed.error.message);

  const { apiV1, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.list<Record<string, unknown>>(`/projects/${parsed.data.project_id}/groups`), { label: `pipedrive_project_groups_list ${parsed.data.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_groups_list", `GET /projects/${parsed.data.project_id}/groups`));
  return successResult({ project_id: parsed.data.project_id, groups: response.data.data ?? [] });
}

async function handleProjectPlanGet(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectPlanGetSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_plan_get", parsed.error.message);

  const { apiV1, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.list<Record<string, unknown>>(`/projects/${parsed.data.project_id}/plan`), { label: `pipedrive_project_plan_get ${parsed.data.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_plan_get", `GET /projects/${parsed.data.project_id}/plan`));
  return successResult({ project_id: parsed.data.project_id, plan_items: response.data.data ?? [] });
}

async function handleProjectPlanUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectPlanUpdateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_plan_update", parsed.error.message);

  const input = parsed.data;
  if (input.phase_id === undefined && input.group_id === undefined) {
    return validationErrorResult("pipedrive_project_plan_update", "Provide phase_id and/or group_id to update the plan item.");
  }

  const segment = input.item_type === "activity" ? "activities" : "tasks";
  const path = `/projects/${input.project_id}/plan/${segment}/${input.item_id}`;

  const body: Record<string, unknown> = {};
  if (input.phase_id !== undefined) body.phase_id = input.phase_id;
  if (input.group_id !== undefined) body.group_id = input.group_id;

  const { apiV1, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.put<Record<string, unknown>>(path, body), { label: `pipedrive_project_plan_update ${input.project_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_plan_update", `PUT ${path}`));
  return successResult({ message: `Plan ${input.item_type} ${input.item_id} updated in project ${input.project_id}`, item: response.data.data });
}

const BETA_NOTE = "Uses Pipedrive's BETA Projects API and requires the paid Projects add-on.";

const tools: ToolDefinition[] = [
  { name: "pipedrive_projects_list", description: `List projects with filters and pagination. Set archived_only: true for archived projects. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsListSchema), handler: handleProjectsList },
  { name: "pipedrive_projects_get", description: `Get a single project by ID, including resolved custom fields. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsGetSchema), handler: handleProjectsGet },
  { name: "pipedrive_projects_search", description: `Search projects by title, description, notes, or custom fields. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsSearchSchema), handler: handleProjectsSearch },
  { name: "pipedrive_projects_create", description: `Create a new project, optionally from a template (template_id). ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsCreateSchema), handler: handleProjectsCreate },
  { name: "pipedrive_projects_update", description: `Update an existing project. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsUpdateSchema), handler: handleProjectsUpdate },
  { name: "pipedrive_projects_delete", description: `Delete a project. Requires confirm: "DELETE". Supports dry_run. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsDeleteSchema), handler: handleProjectsDelete },
  // "archive" doesn't match the write-tool name patterns, so flag it explicitly
  { name: "pipedrive_projects_archive", description: `Archive a project (reversible; archived projects appear in pipedrive_projects_list with archived_only: true). ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsArchiveSchema), handler: handleProjectsArchive, isWriteTool: true },
  { name: "pipedrive_projects_changelog", description: `List field-change history for a project. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsChangelogSchema), handler: handleProjectsChangelog },
  { name: "pipedrive_projects_permitted_users", description: `List the users permitted to access a project. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectsPermittedUsersSchema), handler: handleProjectsPermittedUsers },
  { name: "pipedrive_project_activities_list", description: `List activities linked to a project. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectActivitiesListSchema), handler: handleProjectActivitiesList },
  { name: "pipedrive_project_groups_list", description: `List the active task groups within a project. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectGroupsListSchema), handler: handleProjectGroupsList },
  { name: "pipedrive_project_plan_get", description: `Get a project's plan: its tasks and activities with their phase and group assignments. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectPlanGetSchema), handler: handleProjectPlanGet },
  { name: "pipedrive_project_plan_update", description: `Move a task or activity within a project plan by assigning its phase and/or group. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectPlanUpdateSchema), handler: handleProjectPlanUpdate },
];

registerTools(tools);
