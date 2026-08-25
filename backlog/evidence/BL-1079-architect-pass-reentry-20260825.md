# BL-1079 — architect pass (re-entry after unhold) — 20260825

**Tip:** cleaner `3b52b93a03` (coder `747a48564e`)
**Handoff:** `50_20260825T113314Z_000790_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope

Re-entry only. Product already on `origin/main`. Delta: APS
`launcherAllowListTokens` uses `[a-z0-9_|-]+` for hyphenated agents.
Tip = cleaner tip + this evidence.

## Architecture

No production change this hop. APS drives real launcher source.

## Invariants

Babashka property runners green:
- `bl1079_provider_agent_allowlist_property_runner.bb` — ALL PASS
- `bl1079_cursor_certification_gate_property_runner.bb` — ALL PASS

## Correctness

Acceptance **5/5**. No defect spotted.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1079-a-cursor-identity-can-be-steward-certified`, commit = this tip.
Authorize BL-1079 paths only.

By architect.
