# BL-1124 — architect pass — 20260825

**Tip:** cleaner `f4f01e96f4` (coder rematch `3ddab12d4f`)
**Handoff:** `00_20260825T190040Z_000859_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...f4f01e96f4` = **4 paths**, **0 deletes** (tip-pure reset).
Rematch only: canary spawn paths must not inherit
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD`. Guard product already on tip/main.

## Architecture

- Root cause of rematch: agent commit env set the skip override, so APS
  scenario 02 / shell 05 green-washed without exercising the bare-flip canary.
- Fix: opt-in `enforcePropertyGuard` deletes the skip in APS `sh()` for the
  canary spawn; shell runner uses `env -u SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD`.
- Isolation ownership unchanged — skip remains valid for non-canary commit
  paths; only verification of the canary forces the real guard.

## Verification

| Check | Result |
|-------|--------|
| `property_suite_shared_repo_guard_test_runner.sh` with `SKIP=1` | ALL PASS |
| APS BL-1124 with `SKIP=1` | 4/4 pass |
| Tip deletes | 0 |

By architect.
