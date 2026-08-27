# BL-1019 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `30d3d62978` (status keys off session + agent child under
pane, not pane_current_command; unknown on gather failure) into
`swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 30d3d62978 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/swarm_status_lib_test_runner.bb`:
   ok.
2. **Babashka unit** —
   `bb swarmforge/scripts/test/agent_process_marker_lib_test_runner.bb`: OK.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1019-swarm-status-agrees-with-has-session.feature`:
   5/5 pass.

## Cleanup performed

- `agent_process_marker_lib.bb`: shared `ps-line-pattern`, `ps-snapshot`,
  `agent-process-line` so status and babysitter cannot drift on child-of-pane
  detection (BL-1108 ONE extended for BL-1019).
- `babysitter_check.bb`: delegates `agent-process-line` to that lib; keeps
  local `ps-snapshot` via `sh!`.
- `swarm_status.bb`: drops duplicate probe; uses lib for snapshot + line.
- `swarm_status_lib.bb`: `maybe-dormant` / `alive-status` keep
  `agent-status-row` CC low.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1019-swarm-status-agrees-with-has-session`.

By cleaner.
