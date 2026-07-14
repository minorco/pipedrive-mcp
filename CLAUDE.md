# Pipedrive MCP Server

## Build instructions
- npm install && npm run build
- npm run dev (watch mode)
- npm test (vitest)

## Architecture rules
- One tool file per entity in src/tools/
- One schema file per entity in src/schemas/
- No business logic in tool handlers - delegate to services/
- No raw HTTP in tool files - use api-v1.ts or api-v2.ts via http-client.ts
- No @ts-ignore - fix types properly
- No hardcoded Pipedrive field keys or option IDs
- All destructive tools require confirm param and support dry_run
- Use native fetch (not axios)
- Use Zod .strict() on all tool input schemas
- v2 activities use participants array, not person_id (which is read-only)
- v2 custom field writes must nest fields in a custom_fields object
- All field metadata endpoints are v1 (v2 field routes are not available on all instances). Exceptions: (a) required/important field config only exists on v2 dealFields (`include_fields=important_fields,required_fields`) — services/field-requirements.ts fetches it and degrades to no-check (returns null) when v2 fields are unavailable; (b) projectFields is v2-only and cursor-paginated — services/custom-fields.ts branches on the endpoint version
- Projects, project tasks, boards, phases, and templates (BETA API) require the paid Projects add-on — their tools append add-on guidance to 403 errors via services/projects-errors.ts
- Write tools whose names don't match WRITE_TOOL_PATTERNS in mcp/register-tools.ts (e.g. `pipedrive_projects_archive`) must set `isWriteTool: true` explicitly on the ToolDefinition

## Testing
- vitest for all tests
- nock for HTTP mocking in integration tests
- Never hit production Pipedrive in tests
- Sanitized fixtures in test/fixtures/v1/ and test/fixtures/v2/

## Key files
- src/pipedrive/endpoint-policy.ts is the source of truth for API routing
- src/services/custom-fields.ts handles all field name resolution

## Dev session

Uses the `dev-session` skill (development plugin). Run session-start before editing, session-end before wrapping.

- Topology: fork-worker
- Repos:
  - fork: /Users/warwickpalm/Work/mcp/pipedrive-mcp  (origin: minorco/pipedrive-mcp, upstream: comma-compliance/pipedrive-mcp)
  - worker: /Users/warwickpalm/Work/mcp/pipedrive-mcp-cloudflare  (origin: minorco/pipedrive-mcp-cloudflare)
- Deploy:
  - Push fork `integration` → `notify-cloudflare` workflow dispatches to the worker repo → `sync-and-deploy` re-runs the fork test gate, syncs the fork into the worker, and pushes worker `dev` → Cloudflare auto-deploys the STAGING worker (`pipedrive-mcp-staging`).
  - Promote to LIVE only via the worker repo's `promote-to-live` workflow (`gh workflow run promote-to-live.yml --repo minorco/pipedrive-mcp-cloudflare`), which merges worker `dev` → `main` → deploys the LIVE worker (`pipedrive-mcp`). Always confirm explicitly before promoting.
  - Fork `main` is intentionally behind `integration`; it only advances on promote. The promote workflow does NOT move it — after a successful promote, fast-forward manually: `git checkout main && git merge --ff-only integration && git push origin main`. Topic branches → merge into `integration`.
- Contribution policy: this fork is MinorCo's own maintained downstream line. Do NOT open PRs to comma-compliance/pipedrive-mcp unless Warwick explicitly asks. comma-compliance is a passive `upstream` remote; pull from it manually and review before folding in. Log upstreamable commits in `UPSTREAM-CANDIDATES.md`.
- Protected branches: the following fork branches back OPEN PRs to comma-compliance/pipedrive-mcp. NEVER delete them in a branch-cleanup or fork-sync pass. Deleting the head branch auto-closes the upstream PR (this happened once on 2026-06-22 and closed all seven at once). Do not prune them until the PR is merged or Warwick says to abandon it:
  - `feat/oauth-bearer-auth` (PR #10)
  - `fix/set-custom-fields-v2` (PR #11)
  - `docs/clarify-note-html-no-cdata` (PR #13)
  - `fix/include-fields-and-activity-type-validation` (PR #14)
  - `fix/activity-presenter-owner-id` (PR #15)
  - `fix/sort-by-enum-correction` (PR #16)
  - `feat/product-variations` (PR #17)
- Specifics: `UPSTREAM-CANDIDATES.md` (upstreamable commit log); `../pipedrive-mcp-cloudflare/SYNC-PROCESS.md` (sync mechanics, worker-only paths); `../pipedrive-mcp-cloudflare/README.md` (deploy/env overview).
