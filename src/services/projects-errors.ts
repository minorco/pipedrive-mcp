import { type HttpResponse } from "../pipedrive/http-client.js";
import { normalizeApiError, type NormalizedError } from "../pipedrive/error-normalizer.js";

// Projects is a paid Pipedrive add-on. Accounts without it get a 403 that is
// indistinguishable from a permissions problem, so all Projects-surface tools
// (projects, project tasks, boards, phases, templates) route their errors here
// to append add-on guidance.
export function normalizeProjectsApiError(
  response: HttpResponse,
  tool: string,
  endpoint: string,
): NormalizedError {
  const err = normalizeApiError(response, tool, endpoint);
  if (err.status === 403) {
    err.guidance +=
      " Note: Projects is a paid Pipedrive add-on. A 403 on a projects endpoint usually means this account does not have the Projects add-on enabled, not a token problem.";
  }
  return err;
}
