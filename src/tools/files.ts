import { registerTools, type ToolDefinition } from "../mcp/register-tools.js";
import { successResult, paginatedResult, type ToolResult } from "../mcp/tool-result.js";
import { apiErrorResult, validationErrorResult } from "../mcp/errors.js";
import { getContext } from "../server.js";
import { withRetry } from "../pipedrive/retries.js";
import { normalizeApiError } from "../pipedrive/error-normalizer.js";
import { compactFile } from "../presenters/entities.js";
import { resolveFilesEndpoint, buildFilePredicate, listFiles, findMailMessageFiles } from "../services/files.js";
import { FilesListSchema, FilesGetSchema, FilesUploadSchema } from "../schemas/files.js";
import { zodToJsonSchema } from "../schemas/zod-to-json.js";

async function handleFilesList(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = FilesListSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_files_list", parsed.error.message);

  const { config } = getContext();
  const input = parsed.data;
  const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);

  if (input.mail_message_id !== undefined) {
    const outcome = await findMailMessageFiles({
      messageId: input.mail_message_id,
      includeInline: input.include_inline ?? false,
      label: "pipedrive_files_list",
    });
    if (!outcome.ok) return apiErrorResult(normalizeApiError(outcome.response, "pipedrive_files_list", outcome.endpoint));
    return paginatedResult({
      items: outcome.items.map(compactFile),
      next_page_token: null,
      approx_count: null,
      truncated: false,
      pagination_mode: "none",
      extra: {
        mail_message_id: input.mail_message_id,
        lookup: outcome.lookup,
        ...(outcome.items.length === 0
          ? { message: "No attachment files found for this message. Inline images are hidden unless include_inline is true; a message with has_attachments_flag false has none." }
          : {}),
      },
    });
  }

  const { path, endpointLabel } = resolveFilesEndpoint(input);
  const predicate = buildFilePredicate(input);

  const outcome = await listFiles({
    path,
    label: "pipedrive_files_list",
    limit,
    cursor: input.cursor,
    sort: input.sort,
    predicate,
  });

  if (!outcome.ok) return apiErrorResult(normalizeApiError(outcome.response, "pipedrive_files_list", endpointLabel));

  const { result, scan } = outcome;
  const extra: Record<string, unknown> = {};
  let message: string | undefined;
  if (scan) {
    extra.scan = scan;
    if (scan.scan_truncated) {
      message = `Scanned ${scan.pages_scanned} page(s) of the scoped listing without exhausting it; pass next_page_token to keep filtering.`;
    }
  }

  return paginatedResult({
    items: result.items.map(compactFile),
    next_page_token: result.next_page_token,
    approx_count: result.approx_count,
    truncated: result.truncated,
    pagination_mode: result.pagination_mode,
    message,
    extra,
  });
}

async function handleFilesGet(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = FilesGetSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_files_get", parsed.error.message);

  const { apiV1, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.get<Record<string, unknown>>(`/files/${parsed.data.file_id}`), { label: `pipedrive_files_get ${parsed.data.file_id}` }),
  );

  if (response.status !== 200) return apiErrorResult(normalizeApiError(response, "pipedrive_files_get", `GET /files/${parsed.data.file_id}`));

  const file = response.data.data as Record<string, unknown>;
  const result: Record<string, unknown> = {
    ...compactFile(file),
    description: (file.description as string) ?? null,
  };
  if (parsed.data.include_download_url && file.url) {
    result.download_url = file.url;
  }
  return successResult(result);
}

async function handleFilesUpload(args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = FilesUploadSchema.safeParse(args);
  if (!parsed.success) return validationErrorResult("pipedrive_files_upload", parsed.error.message);

  const input = parsed.data;

  // Require at least one entity ID
  if (!input.deal_id && !input.person_id && !input.org_id && !input.product_id && !input.activity_id && !input.lead_id) {
    return validationErrorResult("pipedrive_files_upload", "At least one entity ID (deal_id, person_id, org_id, product_id, activity_id, or lead_id) is required");
  }

  // Validate base64
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  const stripped = input.content_base64.replace(/\s/g, "");
  if (!base64Regex.test(stripped) || stripped.length === 0) {
    return validationErrorResult("pipedrive_files_upload", "content_base64 is not valid base64");
  }

  const bytes = Uint8Array.from(Buffer.from(stripped, "base64"));
  const mimeType = input.mime_type ?? "application/octet-stream";

  // Multipart body via FormData so the shared HTTP client supplies auth
  // (Bearer for OAuth connections, api_token otherwise). The previous
  // hand-rolled request appended api_token to the URL, which is undefined
  // under OAuth and made every hosted upload fail with 403.
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), input.file_name);
  const entityFields: [string, string | number | undefined][] = [
    ["deal_id", input.deal_id],
    ["person_id", input.person_id],
    ["org_id", input.org_id],
    ["product_id", input.product_id],
    ["activity_id", input.activity_id],
    ["lead_id", input.lead_id],
  ];
  for (const [name, value] of entityFields) {
    if (value !== undefined) form.append(name, String(value));
  }

  const { apiV1, rateLimiters } = getContext();
  const response = await rateLimiters.general.schedule(() =>
    withRetry(() => apiV1.postMultipart<Record<string, unknown>>("/files", form), { label: "pipedrive_files_upload" }),
  );

  if (response.status !== 200 && response.status !== 201) {
    return apiErrorResult(normalizeApiError(response, "pipedrive_files_upload", "POST /files"));
  }
  const file = response.data.data as Record<string, unknown> | null;
  return successResult({ message: `File "${input.file_name}" uploaded`, file: file ? compactFile(file) : null });
}

const tools: ToolDefinition[] = [
  { name: "pipedrive_files_list", description: "List files. Scope with exactly one of deal_id, person_id, org_id or product_id (account-wide recent files otherwise). activity_id and lead_id filter within a scope. Each file carries mail_message_id when it arrived as an email attachment; pass mail_message_id alone to list one message's attachments (inline images hidden unless include_inline).", inputSchema: zodToJsonSchema(FilesListSchema), handler: handleFilesList },
  { name: "pipedrive_files_get", description: "Get file metadata and optional download URL.", inputSchema: zodToJsonSchema(FilesGetSchema), handler: handleFilesGet },
  { name: "pipedrive_files_upload", description: "Upload a base64-encoded file and attach to an entity.", inputSchema: zodToJsonSchema(FilesUploadSchema), handler: handleFilesUpload },
];

registerTools(tools);
