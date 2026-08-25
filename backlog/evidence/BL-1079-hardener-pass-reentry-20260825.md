# BL-1079 — hardener pass (re-entry) — 2026-08-25

Architect tip: `306a8993c0` (note: discard evidence-only `5c7d764cae`).
Recreated `swarmforge-hardender` on tip. Authorize **BL-1079 paths** only.

## Scope

APS `launcherAllowListTokens` character class includes `-` so hyphenated
agents (e.g. `local-model`) parse like the Babashka property runner.

## Gates

| Check | Result |
|---|---|
| Acceptance | **5/5** |
| `bl1079_provider_agent_allowlist_property_runner.bb` | **ALL PASS** |
| `bl1079_cursor_certification_gate_property_runner.bb` | **ALL PASS** |
| Surgical | **1/1 killed** (revert hyphen from `[a-z0-9_|-]+`) |

## CRAP / Stryker TS

N/A — APS-only re-entry; no new production TS.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1079-a-cursor-identity-can-be-steward-certified`, commit = this tip.

By hardener.
