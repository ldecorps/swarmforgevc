# BL-1023 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `06b678bc7f` (on coder `3bcf29b221`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Decide run-ticket bookkeeping at initiation: adopt paused/hold → active, or
refuse if missing. `move-ticket!` returns `{:ok? …}` (no silent nil). Done
move fails loud if source missing. Dry-run still mutates nothing. Cleaner:
named plan helpers + shared `must-move-ticket!`.

## Architecture

- Matches preferred direction (adopt at initiation; expeditor is the stack).
- Invariant: success never with unchanged backlog state — move or refuse.
- Pure `bookkeep-plan` / `bookkeep-move-ok?`; CLI owns IO and exits.
- Park-others for siblings unchanged; dry-run guards adopt writes.
- Pre-existing `test_expedite_cli.sh` scenario 15 (stage-timeout) noted by
  cleaner as out of scope — not a BL-1023 defect.

## Gates

| Gate | Result |
|---|---|
| Unit (`expedite_lib_test_runner.bb`) | ALL PASS |
| Properties (`bl1023_bookkeep_property_runner.bb`) | ALL HOLD (500) |
| Shell (`test_bl1023_expedite_bookkeep.sh`) | ALL PASSED |
| Acceptance (BL-1023 feature) | **6/6** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/shell/APS) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1023-expeditor-done-bookkeeping-silently-no-ops-when-its-ticket-is-not-active`.

By architect.
