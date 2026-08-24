# BL-1019 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `0458413c62` (on coder `30d3d62978`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

`./swarm status` keys off session presence + agent child under the pane
(not `pane_current_command`). Gather failure → `unknown`, never DOWN.
Cleaner: shared `agent-process-line` / ps helpers with babysitter so the
two surfaces cannot drift (BL-1108 ONE extended).

## Architecture

- Matches prior art in babysitterd three-state discrimination (invariant 1–2).
- Pure `agent-liveness-verdict` in `swarm_status_lib`; CLI gathers facts.
- Shared marker probe prevents status vs babysitter disagreement on
  “claude under pane.”
- Scope stays status verdict; attach unchanged.
- Legacy `:alive?` fallback kept for unmigrated callers.

## Gates

| Gate | Result |
|---|---|
| Unit (`swarm_status_lib_test_runner.bb`) | ok |
| Unit (`agent_process_marker_lib_test_runner.bb`) | OK |
| Acceptance (BL-1019 feature) | **5/5** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/APS; no `extension/src` production) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1019-swarm-status-agrees-with-has-session`.

By architect.
