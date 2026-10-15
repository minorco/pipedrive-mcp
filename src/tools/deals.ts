import { registerTools, type ToolDefinition } from "../mcp/register-tools.js";
import { successResult, paginatedResult, type ToolResult } from "../mcp/tool-result.js";
import { apiErrorResult, validationErrorResult } from "../mcp/errors.js";
import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { normalizeApiError } from "../pipedrive/error-normalizer.js";
import { buildPaginationParams, buildPaginatedResult } from "../pipedrive/pagination.js";
import { buildFieldsPayload, resolveCustomFieldsInResponse } from "../services/custom-fields.js";
import { checkDealFieldRequirements, hasMissingFields, getDealFieldRequirements, computeMissingFields, FIELD_REQUIREMENTS_NOTE } from "../services/field-requirements.js";
import { buildDealSummary, isDealSummaryFailure } from "../services/summaries.js";
import { compactDeal, compactDealParticipant } from "../presenters/entities.js";
import { formatDealSummary } from "../presenters/summaries.js";
import {
  DealsListSchema,
  DealsGetSchema,
  DealsSearchSchema,
  DealsSummarySchema,
  DealsMoveStageSchema,
  DealsCreateSchema,
  DealsUpdateSchema,
  DealsDeleteSchema,
  DealParticipantsListSchema,
  DealParticipantsAddSchema,
  DealParticipantsDeleteSchema,
} from "../schemas/deals.js";
import { zodToJsonSchema } from "../schemas/zod-to-json.js";
import { guardErrorResult } from "../mcp/errors.js";
import { validateConfirmation, buildDryRunResult } from "../services/guards.js";

async function handleDealsList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealsListSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deals_list", parsed.error.message);
  }

  const { apiV2, rateLimiters, config } = getContext();
  const input = parsed.data;
  const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);
  const paginationParams = buildPaginationParams("cursor", limit, input.cursor);

  const params: Record<string, string | number | boolean | undefined> = {
    ...paginationParams,
  };

  if (input.ids) params.ids = input.ids.join(",");
  if (input.owner_id) params.owner_id = input.owner_id;
  if (input.person_id) params.person_id = input.person_id;
  if (input.org_id) params.org_id = input.org_id;
  if (input.pipeline_id) params.pipeline_id = input.pipeline_id;
  if (input.stage_id) params.stage_id = input.stage_id;
  if (input.status) params.status = input.status;
  if (input.filter_id) params.filter_id = input.filter_id;
  if (input.updated_since) params.updated_since = input.updated_since;
  if (input.updated_until) params.updated_until = input.updated_until;
  if (input.sort_by) params.sort_by = input.sort_by;
  if (input.sort_direction) params.sort_direction = input.sort_direction;
  if (input.include_fields) params.include_fields = input.include_fields.join(",");
  if (input.custom_field_keys) params.custom_fields = input.custom_field_keys.join(",");

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>("/deals", params), {
      label: "pipedrive_deals_list",
    }),
  );

  if (response.status !== 200) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deals_list", "GET /deals"));
  }

  const items = response.data.data ?? [];
  const result = buildPaginatedResult(items, "cursor", response.data as unknown as Record<string, unknown>);

  return paginatedResult({
    items: result.items.map(compactDeal),
    next_page_token: result.next_page_token,
    approx_count: result.approx_count,
    truncated: result.truncated,
    pagination_mode: result.pagination_mode,
  });
}

async function handleDealsGet(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealsGetSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deals_get", parsed.error.message);
  }

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;

  const params: Record<string, string | number | boolean | undefined> = {};
  if (input.include_fields) params.include_fields = input.include_fields.join(",");
  if (input.custom_field_keys) params.custom_fields = input.custom_field_keys.join(",");

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.get<Record<string, unknown>>(`/deals/${input.deal_id}`, params), {
      label: `pipedrive_deals_get ${input.deal_id}`,
    }),
  );

  if (response.status !== 200) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deals_get", `GET /deals/${input.deal_id}`));
  }

  const deal = response.data.data;
  const customFields = await resolveCustomFieldsInResponse("deal", deal);
  const compact = compactDeal(deal);

  return successResult({
    ...compact,
    custom_fields_resolved: customFields.length > 0 ? customFields : undefined,
    _raw: deal,
  });
}

async function handleDealsSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealsSearchSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deals_search", parsed.error.message);
  }

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
  if (input.status) params.status = input.status;
  if (input.include_fields) params.include_fields = input.include_fields.join(",");

  const response = await rateLimiters.search.schedule(() =>
    withRetry(() => apiV2.list<Record<string, unknown>>("/deals/search", params), {
      label: "pipedrive_deals_search",
    }),
  );

  if (response.status !== 200) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deals_search", "GET /deals/search"));
  }

  const items = response.data.data ?? [];
  const result = buildPaginatedResult(items, "cursor", response.data as unknown as Record<string, unknown>);

  return paginatedResult({
    items: result.items,
    next_page_token: result.next_page_token,
    approx_count: result.approx_count,
    truncated: result.truncated,
    pagination_mode: result.pagination_mode,
  });
}

async function handleDealsSummary(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealsSummarySchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deals_summary", parsed.error.message);
  }

  const input = parsed.data;

  if (input.deal_id) {
    const summary = await buildDealSummary({
      dealId: input.deal_id,
      includeRecentActivities: input.include_recent_activities,
      includeNotes: input.include_notes,
      includeProducts: input.include_products,
      includeEmails: input.include_emails,
    });
    if (isDealSummaryFailure(summary)) {
      return apiErrorResult(normalizeApiError(summary.error, "pipedrive_deals_summary", summary.endpoint));
    }
    return successResult(formatDealSummary(summary));
  }

  // Pipeline summary mode
  const { buildPipelineSummary } = await import("../services/summaries.js");
  const { formatPipelineSummary } = await import("../presenters/summaries.js");
  const pipelineSummary = await buildPipelineSummary({
    pipelineId: input.pipeline_id,
    ownerId: input.owner_id,
    status: input.status,
  });
  return successResult(formatPipelineSummary(pipelineSummary));
}

async function handleDealsMoveStage(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealsMoveStageSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deals_move_stage", parsed.error.message);
  }

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;

  if (input.dry_run) {
    const dealResponse = await rateLimiters.general.schedule(() =>
      withRetry(() => apiV2.get<Record<string, unknown>>(`/deals/${input.deal_id}`), {
        label: `pipedrive_deals_move_stage dry_run ${input.deal_id}`,
      }),
    );
    if (dealResponse.status !== 200) {
      return apiErrorResult(normalizeApiError(dealResponse, "pipedrive_deals_move_stage", `GET /deals/${input.deal_id}`));
    }

    const fields = await getDealFieldRequirements();
    const dryRun = buildDryRunResult(
      "pipedrive_deals_move_stage",
      "move_stage",
      { deal_id: input.deal_id, stage_id: input.stage_id },
      `Would move deal ${input.deal_id} to stage ${input.stage_id}`,
    );
    if (!fields) {
      return successResult({ ...dryRun, field_requirements_unavailable: true });
    }

    const check = computeMissingFields(fields, dealResponse.data.data, { stageId: input.stage_id });
    if (check.required_missing.length > 0 || check.important_missing.length > 0) {
      check.note = FIELD_REQUIREMENTS_NOTE;
    }
    return successResult({ ...dryRun, field_requirements: check });
  }

  const body: Record<string, unknown> = { stage_id: input.stage_id };
  if (input.pipeline_id) body.pipeline_id = input.pipeline_id;

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.patch<Record<string, unknown>>(`/deals/${input.deal_id}`, body), {
      label: `pipedrive_deals_move_stage ${input.deal_id}`,
    }),
  );

  if (response.status !== 200) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deals_move_stage", `PATCH /deals/${input.deal_id}`));
  }

  const check = await checkDealFieldRequirements(response.data.data, { stageId: input.stage_id });

  return successResult({
    message: `Deal ${input.deal_id} moved to stage ${input.stage_id}`,
    deal: compactDeal(response.data.data),
    field_requirements: hasMissingFields(check) ? check : undefined,
  });
}

async function handleDealsCreate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealsCreateSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deals_create", parsed.error.message);
  }

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;

  const body: Record<string, unknown> = { title: input.title };
  if (input.owner_id) body.owner_id = input.owner_id;
  if (input.person_id) body.person_id = input.person_id;
  if (input.org_id) body.org_id = input.org_id;
  if (input.value !== undefined) body.value = input.value;
  if (input.currency) body.currency = input.currency;
  if (input.pipeline_id) body.pipeline_id = input.pipeline_id;
  if (input.stage_id) body.stage_id = input.stage_id;
  if (input.status) body.status = input.status;
  if (input.expected_close_date) body.expected_close_date = input.expected_close_date;
  if (input.visible_to) body.visible_to = input.visible_to;

  // v2 nests custom fields in `custom_fields`; labels go top-level as `label_ids`
  const { payload, errors } = await buildFieldsPayload("deal", input);
  if (errors.length > 0) return validationErrorResult("pipedrive_deals_create", errors.join("; "));
  Object.assign(body, payload);

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.post<Record<string, unknown>>("/deals", body), {
      label: "pipedrive_deals_create",
    }),
  );

  if (response.status !== 200 && response.status !== 201) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deals_create", "POST /deals"));
  }

  const created = response.data.data;
  const check = await checkDealFieldRequirements(created, {});
  const valueUnset = !created.value;

  return successResult({
    message: "Deal created successfully",
    deal: compactDeal(created),
    field_requirements: hasMissingFields(check) ? check : undefined,
    value_hint: valueUnset
      ? "Deal value is not set. If this deal will carry products, add them with pipedrive_deal_products_add and Pipedrive will calculate the value; otherwise set value with pipedrive_deals_update."
      : undefined,
  });
}

async function handleDealsUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealsUpdateSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deals_update", parsed.error.message);
  }

  const { apiV2, rateLimiters } = getContext();
  const input = parsed.data;

  const body: Record<string, unknown> = {};
  if (input.title) body.title = input.title;
  if (input.owner_id) body.owner_id = input.owner_id;
  if (input.person_id) body.person_id = input.person_id;
  if (input.org_id) body.org_id = input.org_id;
  if (input.value !== undefined) body.value = input.value;
  if (input.currency) body.currency = input.currency;
  if (input.pipeline_id) body.pipeline_id = input.pipeline_id;
  if (input.stage_id) body.stage_id = input.stage_id;
  if (input.status) body.status = input.status;
  if (input.expected_close_date) body.expected_close_date = input.expected_close_date;
  if (input.visible_to) body.visible_to = input.visible_to;

  // v2 nests custom fields in `custom_fields`; labels go top-level as `label_ids`
  const { payload, errors } = await buildFieldsPayload("deal", input);
  if (errors.length > 0) return validationErrorResult("pipedrive_deals_update", errors.join("; "));
  Object.assign(body, payload);

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.patch<Record<string, unknown>>(`/deals/${input.deal_id}`, body), {
      label: `pipedrive_deals_update ${input.deal_id}`,
    }),
  );

  if (response.status !== 200) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deals_update", `PATCH /deals/${input.deal_id}`));
  }

  // Stage or status changes can trip UI-required fields - only check then
  const check =
    input.stage_id || input.status
      ? await checkDealFieldRequirements(response.data.data, {
          stageId: input.stage_id,
          status: input.status,
        })
      : null;

  return successResult({
    message: `Deal ${input.deal_id} updated`,
    deal: compactDeal(response.data.data),
    field_requirements: hasMissingFields(check) ? check : undefined,
  });
}

async function handleDealsDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealsDeleteSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deals_delete", parsed.error.message);
  }

  const input = parsed.data;

  if (input.dry_run) {
    return successResult(buildDryRunResult("pipedrive_deals_delete", "delete", { deal_id: input.deal_id }, `Would delete deal ${input.deal_id}`));
  }

  const confirmError = validateConfirmation(input.confirm, "DELETE", "pipedrive_deals_delete", "delete deal");
  if (confirmError) return guardErrorResult(confirmError);

  const { apiV2, rateLimiters } = getContext();

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV2.del(`/deals/${input.deal_id}`), {
      label: `pipedrive_deals_delete ${input.deal_id}`,
    }),
  );

  if (response.status !== 200) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deals_delete", `DELETE /deals/${input.deal_id}`));
  }

  return successResult({ message: `Deal ${input.deal_id} deleted` });
}

// Participants are v1-only (GET/POST /deals/{id}/participants,
// DELETE /deals/{id}/participants/{deal_participant_id}).
async function handleDealParticipantsList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealParticipantsListSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deal_participants_list", parsed.error.message);
  }

  const { apiV1, rateLimiters, config } = getContext();
  const input = parsed.data;
  const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);
  const paginationParams = buildPaginationParams("offset", limit, input.cursor);

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.list<Record<string, unknown>>(`/deals/${input.deal_id}/participants`, { ...paginationParams }), {
      label: `pipedrive_deal_participants_list ${input.deal_id}`,
    }),
  );

  if (response.status !== 200) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deal_participants_list", `GET /deals/${input.deal_id}/participants`));
  }

  const items = response.data.data ?? [];
  const result = buildPaginatedResult(items, "offset", response.data as unknown as Record<string, unknown>);

  return paginatedResult({
    items: result.items.map(compactDealParticipant),
    next_page_token: result.next_page_token,
    approx_count: result.approx_count,
    truncated: result.truncated,
    pagination_mode: result.pagination_mode,
  });
}

async function handleDealParticipantsAdd(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealParticipantsAddSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deal_participants_add", parsed.error.message);
  }

  const { apiV1, rateLimiters } = getContext();
  const input = parsed.data;

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.post<Record<string, unknown>>(`/deals/${input.deal_id}/participants`, { person_id: input.person_id }), {
      label: `pipedrive_deal_participants_add ${input.deal_id}`,
    }),
  );

  if (response.status !== 200 && response.status !== 201) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deal_participants_add", `POST /deals/${input.deal_id}/participants`));
  }

  return successResult({
    message: `Person ${input.person_id} added as a participant on deal ${input.deal_id}`,
    participant: response.data.data ? compactDealParticipant(response.data.data) : null,
  });
}

async function handleDealParticipantsDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = DealParticipantsDeleteSchema.safeParse(args);
  if (!parsed.success) {
    return validationErrorResult("pipedrive_deal_participants_delete", parsed.error.message);
  }

  const input = parsed.data;
  const target = { deal_id: input.deal_id, deal_participant_id: input.deal_participant_id };

  if (input.dry_run) {
    return successResult(
      buildDryRunResult(
        "pipedrive_deal_participants_delete",
        "delete",
        target,
        `Would remove participant ${input.deal_participant_id} from deal ${input.deal_id} (the person record is kept)`,
      ),
    );
  }

  const confirmError = validateConfirmation(input.confirm, "DELETE", "pipedrive_deal_participants_delete", "remove participant from deal");
  if (confirmError) return guardErrorResult(confirmError);

  const { apiV1, rateLimiters } = getContext();
  const path = `/deals/${input.deal_id}/participants/${input.deal_participant_id}`;

  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.del(path), {
      label: `pipedrive_deal_participants_delete ${input.deal_participant_id}`,
    }),
  );

  if (response.status !== 200) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_deal_participants_delete", `DELETE ${path}`));
  }

  return successResult({ message: `Participant ${input.deal_participant_id} removed from deal ${input.deal_id}` });
}

const tools: ToolDefinition[] = [
  {
    name: "pipedrive_deals_list",
    description: "List deals with filters and pagination. Returns compact deal summaries with IDs, titles, stages, values, and linked entity IDs.",
    inputSchema: zodToJsonSchema(DealsListSchema),
    handler: handleDealsList,
  },
  {
    name: "pipedrive_deals_get",
    description: "Get a single deal by ID with full details including resolved custom fields.",
    inputSchema: zodToJsonSchema(DealsGetSchema),
    handler: handleDealsGet,
  },
  {
    name: "pipedrive_deals_search",
    description: "Search deals by term. Returns matching deals with relevance scoring.",
    inputSchema: zodToJsonSchema(DealsSearchSchema),
    handler: handleDealsSearch,
  },
  {
    name: "pipedrive_deals_summary",
    description:
      "Get a Claude-friendly deal or pipeline snapshot. Pass deal_id for a single deal summary with optional activities/notes/products/emails (include_emails adds the email count and the 3 most recent visible emails: subject, sender, date, snippet). Omit deal_id for a pipeline overview with stage counts.",
    inputSchema: zodToJsonSchema(DealsSummarySchema),
    handler: handleDealsSummary,
  },
  {
    name: "pipedrive_deals_move_stage",
    description:
      "Move a deal to a different stage (and optionally pipeline). Prefer dry_run: true first - it previews the fields Pipedrive marks required or important at the target stage without moving the deal. The move response also flags missing required/important fields (the API does not enforce them). Populate dropdown fields from the returned options when the value is obvious; ask the user for text fields.",
    inputSchema: zodToJsonSchema(DealsMoveStageSchema),
    handler: handleDealsMoveStage,
  },
  {
    name: "pipedrive_deals_create",
    description:
      "Create a new deal. Supports custom fields by name or key, and the native Label field via label_ids (IDs or label names). The response flags any fields Pipedrive marks required or important at the deal's stage - populate them (dropdowns from the returned options; ask the user for text fields) rather than leaving them empty.",
    inputSchema: zodToJsonSchema(DealsCreateSchema),
    handler: handleDealsCreate,
  },
  {
    name: "pipedrive_deals_update",
    description:
      "Update an existing deal. Supports custom fields by name or key, and the native Label field via label_ids (IDs or label names). When changing stage or status (won/lost), the response flags fields Pipedrive marks required or important for that stage/status - populate them rather than leaving them empty.",
    inputSchema: zodToJsonSchema(DealsUpdateSchema),
    handler: handleDealsUpdate,
  },
  {
    name: "pipedrive_deals_delete",
    description: 'Delete a deal. Requires confirm: "DELETE". Supports dry_run for preview.',
    inputSchema: zodToJsonSchema(DealsDeleteSchema),
    handler: handleDealsDelete,
  },
  {
    name: "pipedrive_deal_participants_list",
    description:
      "List the people participating in a deal (Pipedrive's Participants section, including the primary contact). Each item's id is the deal-participant link id used by pipedrive_deal_participants_delete; person_id is the person.",
    inputSchema: zodToJsonSchema(DealParticipantsListSchema),
    handler: handleDealParticipantsList,
  },
  {
    name: "pipedrive_deal_participants_add",
    description:
      "Add an existing person to a deal as a participant. Find the person_id with pipedrive_persons_search; create the person first if they do not exist.",
    inputSchema: zodToJsonSchema(DealParticipantsAddSchema),
    handler: handleDealParticipantsAdd,
  },
  {
    name: "pipedrive_deal_participants_delete",
    description:
      'Remove a participant from a deal (the person record is kept). Takes the deal_participant_id from pipedrive_deal_participants_list. Requires confirm: "DELETE". Supports dry_run for preview.',
    inputSchema: zodToJsonSchema(DealParticipantsDeleteSchema),
    handler: handleDealParticipantsDelete,
  },
];

registerTools(tools);
