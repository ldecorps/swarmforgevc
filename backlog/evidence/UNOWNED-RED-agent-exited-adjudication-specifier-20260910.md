# Adjudication: unowned red, AGENT_EXITED not reported across three acceptance features

Specifier, 2026-09-10, on the coder's priority-00 note of 12:15Z
("unowned-red: AGENT_EXITED not reported (BL-359 s6, BL-647 s2-6, BL-368 s3)",
evidence `backlog/evidence/UNOWNED-RED-agent-exited-detection-coder-20260910.md`
on the coder branch, `92210ba912`).

## Outcome: mint BL-1514 (`type: defect`, `severity: high`), three register rows

## Reproduction

Detached throwaway checkout of the coder's BL-1449 tip `b099da3351` under the
session scratchpad (`git worktree add --detach`; `rev-parse --git-common-dir`
confirmed the live `.git`; removed after use), `extension/out` and
`node_modules` symlinked from the master checkout. The coder tip is needed only
so hotfix `32fb1ff7e1`'s ninth fixture-list drift (BL-1449's own subject) stops
aborting `operator_runtime.bb --tick-once` at load before any assertion runs.

| feature | result | first failing step |
|---|---|---|
| BL-368-control-loss-is-not-agent-death | pass 3 / fail 1 | scenario 03 "it reports that role as exited": expected QA reported as AGENT_EXITED, got: (empty) |
| BL-647-rotation-router-liveness | pass 2 / fail 5 | scenarios 02 [1],[2], 03, 04, 05: expected exactly one AGENT_EXITED event, got: [] |
| BL-359-always-on-operator-presence | pass 6 / fail 1 | scenario 05 (run index 6) "the swarm still detects and recovers them": expected QA still reported AGENT_EXITED |

Sibling shell lane on the same tree, both green:
`test_operator_runtime_control_lost.sh` ("BL-653: dead-agent-events no longer
runs from operator tick (babysitter owns liveness)") and
`test_operator_runtime_bl647_rotation_liveness.sh` ("BL-653/BL-647-wire-02:
operator tick emits zero AGENT_EXITED when resident is absent").

## Trace to the site

- `operator_runtime.bb` `tick!` never calls `operator-lib/dead-agent-events`;
  `grep -rn dead-agent-events swarmforge/scripts/*.bb` hits only the defn in
  `operator_lib.bb` and a comment in `tick!` (line 2236 at mint). The
  `rotation-mode` / `rotation-opts` bindings computed at lines 2237-2240 feed
  nothing.
- `tick-observed-events` docstring (BL-653): "Excludes dead-agent-events and
  SWARM_CHECK_TIMER - liveness and periodic patrol belong to the deterministic
  babysitter; the LLM Operator is summoned, never scheduled."
- BL-653 landed `309e11bdef` on 2026-08-26 (done/M8). Its feature scenario 05
  asserts "no fabricated AGENT_EXITED events accompany that wake". It updated
  the two shell tests above to assert zero events and left the three
  acceptance features asserting the opposite. BL-1006's shape: the successor
  never retired the boundary it falsified.

## Why fold-in was rejected

The register is keyed per test file; no existing row names any of the three
features, and no open ticket (paused/active/hold) names them, their handlers,
`dead-agent-events`, or the operator tick's liveness. BL-1449 (active, coder)
is the mask-remover, not the owner: its scope is the fixture-list derivation.

## Why one ticket, not three

One cause (BL-653's unretired boundary), one remedy (retire, never reword;
delete the dead producer), one hardener re-stamp pass over the two surviving
features, one land. Splitting would put three parcels on the same two source
files and the same register edit.

## Successor coverage cited in the ticket

BL-653 scenario 05 (no fabricated AGENT_EXITED), BL-611 (per-role pane+process
sweep check), BL-1017 ("a standing role with no pane asks for its session to
be recreated"), BL-804 ("dormant-role absence is quiet on a green router
sweep", "a missing required session is still CRIT under router mode").
