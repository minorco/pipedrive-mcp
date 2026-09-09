import { type HttpResponse } from "../pipedrive/http-client.js";
import { normalizeApiError, type NormalizedError } from "../pipedrive/error-normalizer.js";

// Projects is a paid Pipedrive add-on. Accounts without it get a 403 (or a
// 402 "Required suites missing") that is indistinguishable from a permissions
// problem, so all Projects-surface tools (projects, project tasks, boards,
// phases, templates) route their errors here to append add-on guidance.
export function normalizeProjectsApiError(
  response: HttpResponse,
  tool: string,
  endpoint: string,
): NormalizedError {
  const err = normalizeApiError(response, tool, endpoint);
  if (err.status === 403 && endpoint.endsWith("/projects/archived")) {
    // Verified against a live account with the Projects scope at Full access:
    // Pipedrive's OAuth permission map does not cover GET /projects/archived,
    // so OAuth connections get "Scope and URL mismatch" regardless of scopes.
    err.guidance =
      "Pipedrive's OAuth permissions do not cover the archived-projects endpoint, so archived projects cannot be listed through an OAuth connection even with the Projects scope at Full access. Active projects list normally; archived ones remain visible in Pipedrive's own UI.";
    return err;
  }
  if (err.status === 403 || err.status === 402) {
    err.guidance +=
      ` Note: Projects is a paid Pipedrive add-on. A ${err.status} on a projects endpoint usually means this account does not have the Projects add-on enabled, not a token problem.`;
  }
  return err;
}
