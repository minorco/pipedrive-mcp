import { registerTools, type ToolDefinition } from "../mcp/register-tools.js";
import { successResult, paginatedResult, type ToolResult } from "../mcp/tool-result.js";
import { apiErrorResult, validationErrorResult, guardErrorResult } from "../mcp/errors.js";
import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { normalizeProjectsApiError } from "../services/projects-errors.js";
import { buildPaginationParams, buildPaginatedResult } from "../pipedrive/pagination.js";
import { compactProjectTask } from "../presenters/entities.js";
import { validateConfirmation, buildDryRunResult } from "../services/guards.js";
import {
  ProjectTasksListSchema,
  ProjectTasksGetSchema,
  ProjectTasksCreateSchema,
  ProjectTasksUpdateSchema,
  ProjectTasksDeleteSchema,
} from "../schemas/project-tasks.js";
import { zodToJsonSchema } from "../schemas/zod-to-json.js";

type TaskWriteInput = {
  description?: string;
  done?: boolean;
  milestone?: boolean;
  due_date?: string;
  start_date?: string;
  assignee_id?: number;
  priority?: number;
};

// The v2 tasks API encodes done/milestone as 0/1 on write
function buildTaskBody(input: TaskWriteInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.description !== undefined) body.description = input.description;
  if (input.done !== undefined) body.done = input.done ? 1 : 0;
  if (input.milestone !== undefined) body.milestone = input.milestone ? 1 : 0;
  if (input.due_date) body.due_date = input.due_date;
  if (input.start_date) body.start_date = input.start_date;
  if (input.assignee_id) body.assignee_id = input.assignee_id;
  if (input.priority !== undefined) body.priority = input.priority;
  return body;
}

async function handleProjectTasksList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectTasksListSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_tasks_list", parsed.error.message);

  const { apiV2, rateLimiters, config } = getContext();
  const input = parsed.data;
  const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);
  const paginationParams = buildPaginationParams("cursor", limit, input.cursor);

  const params: Record<string, string | number | boolean | undefined> = { ...paginationParams };
  if (input.project_id) params.project_id = input.project_id;
  if (input.parent_task_id !== undefined) params.parent_task_id = input.parent_task_id;
  if (input.assignee_id) params.assignee_id = input.assignee_id;
  if (input.is_done !== undefined) params.is_done = input.is_done;
  if (input.is_milestone !== undefined) params.is_milestone = input.is_milestone;

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>("/tasks", params), { label: "pipedrive_project_tasks_list" }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_tasks_list", "GET /tasks"));

  const items = response.data.data ?? [];
  const result = buildPaginatedResult(items, "cursor", response.data as unknown as Record<string, unknown>);
  return paginatedResult({ items: result.items.map(compactProjectTask), next_page_token: result.next_page_token, approx_count: result.approx_count, truncated: result.truncated, pagination_mode: result.pagination_mode });
}

async function handleProjectTasksGet(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectTasksGetSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_tasks_get", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.get<Record<string, unknown>>(`/tasks/${parsed.data.task_id}`), { label: `pipedrive_project_tasks_get ${parsed.data.task_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_tasks_get", `GET /tasks/${parsed.data.task_id}`));

  const task = response.data.data;
  return successResult({ ...compactProjectTask(task), _raw: task });
}

async function handleProjectTasksCreate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectTasksCreateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_tasks_create", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;

  const body = buildTaskBody(input);
  body.title = input.title;
  body.project_id = input.project_id;
  if (input.parent_task_id) body.parent_task_id = input.parent_task_id;

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.post<Record<string, unknown>>("/tasks", body), { label: "pipedrive_project_tasks_create" }),
  );

  if (response.status !== 200 && response.status !== 201) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_tasks_create", "POST /tasks"));
  return successResult({ message: "Project task created", task: compactProjectTask(response.data.data) });
}

async function handleProjectTasksUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectTasksUpdateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_tasks_update", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;

  const body = buildTaskBody(input);
  if (input.title) body.title = input.title;
  if (input.project_id) body.project_id = input.project_id;
  if (input.parent_task_id) body.parent_task_id = input.parent_task_id;

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.patch<Record<string, unknown>>(`/tasks/${input.task_id}`, body), { label: `pipedrive_project_tasks_update ${input.task_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_tasks_update", `PATCH /tasks/${input.task_id}`));
  return successResult({ message: `Project task ${input.task_id} updated`, task: compactProjectTask(response.data.data) });
}

async function handleProjectTasksDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectTasksDeleteSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_tasks_delete", parsed.error.message);

  const input = parsed.data;
  if (input.dry_run) return successResult(buildDryRunResult("pipedrive_project_tasks_delete", "delete", { task_id: input.task_id }, `Would delete project task ${input.task_id} and its subtasks`));

  const confirmError = validateConfirmation(input.confirm, "DELETE", "pipedrive_project_tasks_delete", "delete project task (cascades to subtasks)");
  if (confirmError) return guardErrorResult(confirmError);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.del(`/tasks/${input.task_id}`), { label: `pipedrive_project_tasks_delete ${input.task_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_tasks_delete", `DELETE /tasks/${input.task_id}`));
  return successResult({ message: `Project task ${input.task_id} deleted (subtasks cascade)` });
}

const TASK_NOTE = "Project task (Projects add-on) — not the 'task' activity type; use the activities tools for those. Uses Pipedrive's BETA Projects API.";

const tools: ToolDefinition[] = [
  { name: "pipedrive_project_tasks_list", description: `List project tasks with filters (project_id, assignee_id, is_done, is_milestone, parent_task_id) and pagination. ${TASK_NOTE}`, inputSchema: zodToJsonSchema(ProjectTasksListSchema), handler: handleProjectTasksList },
  { name: "pipedrive_project_tasks_get", description: `Get a single project task by ID. ${TASK_NOTE}`, inputSchema: zodToJsonSchema(ProjectTasksGetSchema), handler: handleProjectTasksGet },
  { name: "pipedrive_project_tasks_create", description: `Create a project task, optionally as a subtask via parent_task_id. ${TASK_NOTE}`, inputSchema: zodToJsonSchema(ProjectTasksCreateSchema), handler: handleProjectTasksCreate },
  { name: "pipedrive_project_tasks_update", description: `Update a project task (title, done, milestone, dates, assignee, priority). ${TASK_NOTE}`, inputSchema: zodToJsonSchema(ProjectTasksUpdateSchema), handler: handleProjectTasksUpdate },
  { name: "pipedrive_project_tasks_delete", description: `Delete a project task and its subtasks. Requires confirm: "DELETE". Supports dry_run. ${TASK_NOTE}`, inputSchema: zodToJsonSchema(ProjectTasksDeleteSchema), handler: handleProjectTasksDelete },
];

registerTools(tools);
