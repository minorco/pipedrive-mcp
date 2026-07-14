import { registerTools, type ToolDefinition } from "../mcp/register-tools.js";
import { successResult, type ToolResult } from "../mcp/tool-result.js";
import { apiErrorResult, validationErrorResult, guardErrorResult } from "../mcp/errors.js";
import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { normalizeProjectsApiError } from "../services/projects-errors.js";
import { compactBoard, compactPhase } from "../presenters/entities.js";
import { validateConfirmation, buildDryRunResult } from "../services/guards.js";
import {
  ProjectBoardsListSchema,
  ProjectBoardsGetSchema,
  ProjectBoardsCreateSchema,
  ProjectBoardsUpdateSchema,
  ProjectBoardsDeleteSchema,
  ProjectPhasesListSchema,
  ProjectPhasesGetSchema,
  ProjectPhasesCreateSchema,
  ProjectPhasesUpdateSchema,
  ProjectPhasesDeleteSchema,
} from "../schemas/project-boards.js";
import { zodToJsonSchema } from "../schemas/zod-to-json.js";

async function handleProjectBoardsList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectBoardsListSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_boards_list", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>("/boards"), { label: "pipedrive_project_boards_list" }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_boards_list", "GET /boards"));
  return successResult({ boards: (response.data.data ?? []).map(compactBoard) });
}

async function handleProjectBoardsGet(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectBoardsGetSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_boards_get", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.get<Record<string, unknown>>(`/boards/${parsed.data.board_id}`), { label: `pipedrive_project_boards_get ${parsed.data.board_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_boards_get", `GET /boards/${parsed.data.board_id}`));
  return successResult(compactBoard(response.data.data));
}

async function handleProjectBoardsCreate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectBoardsCreateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_boards_create", parsed.error.message);

  const input = parsed.data;
  const body: Record<string, unknown> = { name: input.name };
  if (input.order_nr) body.order_nr = input.order_nr;

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.post<Record<string, unknown>>("/boards", body), { label: "pipedrive_project_boards_create" }),
  );

  if (response.status !== 200 && response.status !== 201) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_boards_create", "POST /boards"));
  return successResult({ message: "Project board created", board: compactBoard(response.data.data) });
}

async function handleProjectBoardsUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectBoardsUpdateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_boards_update", parsed.error.message);

  const input = parsed.data;
  const body: Record<string, unknown> = {};
  if (input.name) body.name = input.name;
  if (input.order_nr) body.order_nr = input.order_nr;

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.patch<Record<string, unknown>>(`/boards/${input.board_id}`, body), { label: `pipedrive_project_boards_update ${input.board_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_boards_update", `PATCH /boards/${input.board_id}`));
  return successResult({ message: `Project board ${input.board_id} updated`, board: compactBoard(response.data.data) });
}

async function handleProjectBoardsDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectBoardsDeleteSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_boards_delete", parsed.error.message);

  const input = parsed.data;
  if (input.dry_run) return successResult(buildDryRunResult("pipedrive_project_boards_delete", "delete", { board_id: input.board_id }, `Would delete project board ${input.board_id}, affecting its phases and the projects on it`));

  const confirmError = validateConfirmation(input.confirm, "DELETE", "pipedrive_project_boards_delete", "delete project board (affects its phases and projects)");
  if (confirmError) return guardErrorResult(confirmError);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.del(`/boards/${input.board_id}`), { label: `pipedrive_project_boards_delete ${input.board_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_boards_delete", `DELETE /boards/${input.board_id}`));
  return successResult({ message: `Project board ${input.board_id} deleted` });
}

async function handleProjectPhasesList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectPhasesListSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_phases_list", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>("/phases", { board_id: parsed.data.board_id }), { label: "pipedrive_project_phases_list" }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_phases_list", "GET /phases"));
  return successResult({ board_id: parsed.data.board_id, phases: (response.data.data ?? []).map(compactPhase) });
}

async function handleProjectPhasesGet(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectPhasesGetSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_phases_get", parsed.error.message);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.get<Record<string, unknown>>(`/phases/${parsed.data.phase_id}`), { label: `pipedrive_project_phases_get ${parsed.data.phase_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_phases_get", `GET /phases/${parsed.data.phase_id}`));
  return successResult(compactPhase(response.data.data));
}

async function handleProjectPhasesCreate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectPhasesCreateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_phases_create", parsed.error.message);

  const input = parsed.data;
  const body: Record<string, unknown> = { name: input.name, board_id: input.board_id };
  if (input.order_nr) body.order_nr = input.order_nr;

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.post<Record<string, unknown>>("/phases", body), { label: "pipedrive_project_phases_create" }),
  );

  if (response.status !== 200 && response.status !== 201) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_phases_create", "POST /phases"));
  return successResult({ message: "Project phase created", phase: compactPhase(response.data.data) });
}

async function handleProjectPhasesUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectPhasesUpdateSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_phases_update", parsed.error.message);

  const input = parsed.data;
  const body: Record<string, unknown> = {};
  if (input.name) body.name = input.name;
  if (input.board_id) body.board_id = input.board_id;
  if (input.order_nr) body.order_nr = input.order_nr;

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.patch<Record<string, unknown>>(`/phases/${input.phase_id}`, body), { label: `pipedrive_project_phases_update ${input.phase_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_phases_update", `PATCH /phases/${input.phase_id}`));
  return successResult({ message: `Project phase ${input.phase_id} updated`, phase: compactPhase(response.data.data) });
}

async function handleProjectPhasesDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = ProjectPhasesDeleteSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_project_phases_delete", parsed.error.message);

  const input = parsed.data;
  if (input.dry_run) return successResult(buildDryRunResult("pipedrive_project_phases_delete", "delete", { phase_id: input.phase_id }, `Would delete project phase ${input.phase_id}, affecting the projects currently in it`));

  const confirmError = validateConfirmation(input.confirm, "DELETE", "pipedrive_project_phases_delete", "delete project phase (affects projects in it)");
  if (confirmError) return guardErrorResult(confirmError);

  const { apiV2, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.del(`/phases/${input.phase_id}`), { label: `pipedrive_project_phases_delete ${input.phase_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeProjectsApiError(response, "pipedrive_project_phases_delete", `DELETE /phases/${input.phase_id}`));
  return successResult({ message: `Project phase ${input.phase_id} deleted` });
}

const BETA_NOTE = "Uses Pipedrive's BETA Projects API and requires the paid Projects add-on.";

const tools: ToolDefinition[] = [
  { name: "pipedrive_project_boards_list", description: `List all active project boards. Boards are to projects what pipelines are to deals. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectBoardsListSchema), handler: handleProjectBoardsList },
  { name: "pipedrive_project_boards_get", description: `Get a single project board by ID. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectBoardsGetSchema), handler: handleProjectBoardsGet },
  { name: "pipedrive_project_boards_create", description: `Create a project board. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectBoardsCreateSchema), handler: handleProjectBoardsCreate },
  { name: "pipedrive_project_boards_update", description: `Rename or reorder a project board. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectBoardsUpdateSchema), handler: handleProjectBoardsUpdate },
  { name: "pipedrive_project_boards_delete", description: `Delete a project board. Affects its phases and the projects on it. Requires confirm: "DELETE". Supports dry_run. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectBoardsDeleteSchema), handler: handleProjectBoardsDelete },
  { name: "pipedrive_project_phases_list", description: `List the phases of a project board (board_id required). Phases are to boards what stages are to pipelines. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectPhasesListSchema), handler: handleProjectPhasesList },
  { name: "pipedrive_project_phases_get", description: `Get a single project phase by ID. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectPhasesGetSchema), handler: handleProjectPhasesGet },
  { name: "pipedrive_project_phases_create", description: `Create a phase on a project board. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectPhasesCreateSchema), handler: handleProjectPhasesCreate },
  { name: "pipedrive_project_phases_update", description: `Rename, reorder, or move a project phase. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectPhasesUpdateSchema), handler: handleProjectPhasesUpdate },
  { name: "pipedrive_project_phases_delete", description: `Delete a project phase. Affects the projects currently in it. Requires confirm: "DELETE". Supports dry_run. ${BETA_NOTE}`, inputSchema: zodToJsonSchema(ProjectPhasesDeleteSchema), handler: handleProjectPhasesDelete },
];

registerTools(tools);
