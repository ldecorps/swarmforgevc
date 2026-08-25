# BL-1079 — architect pass (re-entry after unhold) — 20260825

**Tip:** cleaner `3b52b93a03` (coder `747a48564e` on origin/main-only rematch)
**Handoff:** `50_20260825T113314Z_000790_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope

Re-entry only. Product already on `origin/main`. Intentional delta: APS
`launcherAllowListTokens` character class `[a-z0-9_|-]+` so hyphenated
agents (`local-model`) parse like the babashka property runner. Ticket
restored hold→active. Tip paths = **4**, BL-1079-only.

## Architecture

No production module change this hop. Steward certify / seed / ModelFactory
gates unchanged. APS still drives real launcher source.

## Invariants (2) — encoded on tip (babashka runners)

Both property runners green this pass:
- `bl1079_provider_agent_allowlist_property_runner.bb` — ALL PASS
- `bl1079_cursor_certification_gate_property_runner.bb` — ALL PASS

## Correctness

Acceptance **5/5 PASS**. No defect spotted.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1079-a-cursor-identity-can-be-steward-certified`, commit = this tip.
Authorize BL-1079 paths only.

By architect.
