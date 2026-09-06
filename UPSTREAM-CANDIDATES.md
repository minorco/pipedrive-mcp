# Upstream candidates

This fork (`minorco/pipedrive-mcp`) is maintained as MinorCo's own downstream line. We do **not** open PRs to `comma-compliance/pipedrive-mcp` by default.

This file tracks commits that are genuinely upstreamable — generic fixes and improvements that aren't MinorCo-specific — so that if the upstream maintainer becomes active again we can harvest them into clean PRs without archaeology.

## How to use

- When you land a commit that would benefit upstream (a real bug fix or broadly-useful feature, not MinorCo-specific behaviour or config), add a row below.
- Keep the commit atomic so it cherry-picks cleanly onto `upstream/main`.
- When Warwick decides to contribute back, cherry-pick the listed SHAs onto a branch off `upstream/main` and open the PR(s) then — not before.

## Candidates

| Commit | Date | Summary | Why upstreamable |
|--------|------|---------|------------------|
| `ae8808d` | 2026-06-23 | Coerce `visible_to` to int (string enum → number) and validate activity `type` against the account's real activity-type keys | Both are generic correctness fixes for Pipedrive v2 validation 400s (Sentry PIPEDRIVE-MCP-C and -8). No MinorCo-specific behaviour. |
| `df02c56` | 2026-06-29 | Coerce monetary/qty fields (deal/lead value, product price/cost/tax/qty/discount) to numbers via `z.coerce.number()` | Direct fix for issue #18 (numeric args sent as strings by some clients). IDs were already coerced; this closes the same gap on the remaining numeric write fields. Fully generic. |
| `7b96abd` | 2026-07-06 | Surface required/important deal fields (v2 dealFields include_fields) on create/move_stage/won-lost, dry_run preview on move_stage, recalculated deal value after product changes | UI-only enforcement of required fields is a Pipedrive platform gap every API client hits. Fully generic, degrades gracefully on instances without v2 field routes. |
| `4b6dcd2` | 2026-07-07 | Expose owner_id on deals create/update | v2 API supports it; omission means deals cannot be assigned via the MCP. Generic gap, trivially upstreamable. |
| `9c20d44` | 2026-07-09 | label_ids on deal writes; deal_value staleness note; monetary display_value formatting | All generic correctness gaps found testing against a live instance. |
| `0c6aa90` | 2026-07-16 | Cap ids list filters at 100 with batching guidance; enforce opaque page-token format in schema; typed PageTokenError mapped to a validation (not internal) error | Both are generic agent-input failure modes any MCP client hits (Sentry PIPEDRIVE-MCP-A and -D). No MinorCo-specific behaviour. |
| `a1305a2..1b18501` | 2026-07-14 | Full Pipedrive Projects support: projects (13 tools), project tasks (5), boards/phases (10), templates (2), project custom fields via the v2 projectFields endpoint, 403 add-on guidance | Projects is on the upstream wishlist and the rival server's headline feature. Fully generic — no MinorCo-specific behaviour. Cherry-pick the four feature commits as one branch; they are self-contained (schemas/tools/tests/fixtures per group). |
| `9e3815d` | 2026-07-20 | Attach structured `errorMeta { category, status }` to error tool results alongside the unchanged text | Upstream flattens errors to text, forcing wrappers to string-match messages for retry/refresh decisions — which misclassifies validation errors mentioning "token" (Sentry PIPEDRIVE-MCP-9). Generic: any consumer building retry logic on top of the server benefits. Text output is unchanged, so it is non-breaking. |
| `f83c996` | 2026-07-21 | Lockfile refresh clearing all 12 production npm audit advisories (hono, ip-address via express-rate-limit, qs, body-parser, fast-uri, brace-expansion) | Upstream's own CI has the same `npm audit --omit=dev` gate and the same vulnerable transitive deps, so its CI fails identically. Do not cherry-pick the lockfile diff — regenerate on upstream with `npm audit fix` (all fixes are within declared semver ranges; no package.json change needed). |
| `6047f64` | 2026-07-22 | Override `@hono/node-server` to `^2.0.5` (GHSA-frvp-7c67-39w9) | Upstream's audit gate fails identically: the advisory covers all 1.x, the SDK (<=1.29.0) still declares ^1.19.9, and plain `npm audit fix` silently downgrades the SDK to 1.24.3. Override is the only clean fix until the SDK bumps its range; the affected module (server/streamableHttp.js) is unused on stdio transport. |
| `537a74c` | 2026-09-07 | Fall back to `start + limit` when a v1 offset response reports `more_items_in_collection` without `next_start` | Pipedrive's association listers (deal/person/org mailMessages) omit `next_start`, so upstream silently truncates the same way. Generic pagination fix, no MinorCo-specific behaviour. |
| `e84bf7d` | 2026-09-07 | Shared `SearchTermSchema` enforcing Pipedrive's 2-character minimum search term across all six search tools | Upstream has the same `min(1)` schemas and produces the same 400. Surfaces the constraint via JSON Schema `minLength` so agents self-correct. Fully generic. |
| `d47d8c4` | 2026-09-07 | Distinct `forbidden` (403) and `plan` (402) error categories with actionable guidance; 404s downgraded to breadcrumbs instead of Sentry issues | Upstream maps 403 to `auth`, so any wrapper that refreshes on auth errors retries permission failures pointlessly; 402 has no guidance at all. Generic classification fix. |
| `4ce32c3` | 2026-09-07 | `files_list` scopes through the per-entity files sub-resources instead of `GET /files` (which ignores entity params); `compactFile` exposes `mail_message_id`, `mail_template_id`, `inline_flag`, `activity_id`, `product_id`, `lead_id` | Data-boundary bug present upstream: a deal-scoped call returns account-wide files, including other customers' documents. Generic fix with first files test coverage. |
| `1f5b9c7` | 2026-09-07 | `mail_message_id` (+ `include_inline`) filter on `files_list`; `mail_thread_id` and real/inline attachment flags on compact mail messages | Closes the attachment gap every mail-reading client hits: upstream exposes only `has_attachments_flag` with no way to reach the files. Builds on the files scoping fix. |
| `49ecb0e` | 2026-09-07 | Entity mail listers report `reported_count` vs `visible_count` with a visibility note, and accept `include_body` | Pipedrive's per-user email visibility makes every client misread a partial history as complete; upstream has no signal for it. Generic. |
