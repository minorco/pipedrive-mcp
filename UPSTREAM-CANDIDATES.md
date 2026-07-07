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
