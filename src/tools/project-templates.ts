import { registerTools, type ToolDefinition } from "../mcp/register-tools.js";
import { successResult, paginatedResult, type ToolResult } from "../mcp/tool-result.js";
import { apiErrorResult, validationErrorResult } from "../mcp/errors.js";
import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { normalizeProjectsApiError } from "../services/projects-errors.js";
import { buildPaginationParams, buildPaginatedResult } from "../pipedrive/pagination.js";
import { compactProjectTemplate } from "../presenters/entities.js";
import {
  ProjectTemplatesListSchema,
  ProjectTemplatesGetSchema,
} from "../schemas/project-templates.js";
import { zodToJsonSchema } from "../schemas/zod-to-json.js";

async function handleProjectTemplatesList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectTemplatesListSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_templates_list", parsed.error.message);

  const { apiV2, rateLimiters, config } = getContext();
  const input = parsed.data;
  const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);
  const paginationParams = buildPaginationParams("cursor", limit, input.cursor);

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>("/projectTemplates", paginationParams), { label: "pipedrive_project_templates_list" }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_templates_list", "GET /projectTemplates"));

  const items = response.data.data ?? [];
  const result = buildPaginatedResult(items, "cursor", response.data as unknown as Record<string, unknown>);
  return paginatedResult({ items: result.items.map(compactProjectTemplate), next_page_token: result.next_page_token, approx_count: result.approx_count, truncated: result.truncated, pagination_mode: result.pagination_mode });
}

async function handleProjectTemplatesGet(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectTemplatesGetSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_templates_get", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.get<Record<string, unknown>>(`/projectTemplates/${parsed.data.template_id}`), { label: `pipedrive_project_templates_get ${parsed.data.template_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_templates_get", `GET /projectTemplates/${parsed.data.template_id}`));

  const template = response.data.data;
  return successResult({ ...compactProjectTemplate(template), _raw: template });
}

const BETA_NOTE = "Uses Pipedrive's BETA Projects API and requires the paid Projects add-on.";

const tools: ToolDefinition[] = [
  { name: "pipedrive_project_templates_list", description: `List project templates. Use a template's ID as template_id in pipedrive_projects_create. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectTemplatesListSchema), handler: handleProjectTemplatesList },
  { name: "pipedrive_project_templates_get", description: `Get a single project template by ID. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectTemplatesGetSchema), handler: handleProjectTemplatesGet },
];

registerTools(tools);
