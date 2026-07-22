# BL-528 false-positive halt — 2026-07-22T13:51:31Z

## Incident

`handoffd`'s claim-progress circuit breaker halted the whole swarm (killed the tmux
server, coder + coordinator SIGTERM'd) on role `coder` at `reclaims=10`, per
`.swarmforge/daemon/handoffd-failure-20260722T135303Z.log`:

```
13:50:33 claim-progress-bounce coder reclaims=6
13:50:49 claim-progress-bounce coder reclaims=7
13:51:02 claim-progress-bounce coder reclaims=8
13:51:15 claim-progress-bounce coder reclaims=9
13:51:31 claim-progress-halt   coder reclaims=10 — Swarm halted.
```

## Why this is a false positive

At the moment of halt, `.worktrees/coder` had real, substantial uncommitted work:

- Modified: `extension/src/bridge/bridgeServer.ts`, `extension/src/notify/costHealthSidecar.ts`,
  `extension/test/bridgeServer.test.js`, `extension/test/costHealthSidecar.test.js`,
  `swarmforge/scripts/handoffd.bb`, `swarmforge/scripts/operator_lib.bb`,
  `swarmforge/scripts/operator_runtime.bb`, `swarmforge/scripts/test/operator_lib_test_runner.bb`
- New: `extension/src/metrics/llmCostLedgerStore.ts`, `extension/src/tools/swarm-cost-rank.ts`,
  `swarmforge/scripts/llm_cost_ledger_lib.bb` (+ test runner), plus babysitter_assess files.

Pane capture (`tmux capture-pane -t swarmforge-coder`) at 13:52Z, seconds after the halt,
shows the agent mid-generation ("Billowing… 29m38s, ↓88.9k tokens"), actively editing a
test runner file and about to run `npm test`. The last real commit was `568857a0b`
(BL-551 read-side); everything above was staged progress toward the next commit.

Babysitter nudged coder twice via `tmux send-keys` (once at reclaims≈4, once urgently at
reclaims=9) to commit immediately. The agent acknowledged ("Committing prior work already
landed... running the full test suite before finalizing") but the halt fired before the
commit landed.

## Root cause

The reclaim counter increments on every `ready_for_next.sh` call while an in_process
claim is held, regardless of what happened between calls. Coder appears to reflexively
call `ready_for_next.sh` after finishing a sub-step (and gets a "STOP, you already have
work" injected reminder each time — visible 2x in this session's pane scrollback), but
each reflex call still counts toward the halt threshold even while real edits are landing
on disk between calls.

## Recurrence today

- 09:16:54Z role=cleaner reclaims=5 → halt
- 12:45:10Z role=coder reclaims=5 → halt
- 13:51:31Z role=coder reclaims=10 → halt (this incident)

Three full-swarm halts in one day from the same detector. Correlates with the repeated
`kill_all_swarm` entries in `.swarmforge/daemon/kill-all-audit.log` (8 invocations between
12:10 and 13:51).

## Proposed fix (filed against BL-528, still paused)

Gate the bounce/halt thresholds on evidence of real activity (git diff in the role's
worktree, or tool-call count) since the last reclaim, not on raw reclaim count alone.
A role whose worktree diff is growing is not "no progress," even if it keeps calling
`ready_for_next.sh` between edits.

## Remediation taken

1. Verified via `git -C .worktrees/coder status` that all uncommitted work survived the
   halt (worktree files are untouched by tmux/process teardown) — no data lost.
2. Ran `bb swarmforge/scripts/swarm_ensure.bb` — did not bring the swarm back (it reported
   FAILED for every agent respawn) because the whole tmux *server* was gone, not just
   panes; `ensure` only repairs panes against a live server.
3. Relaunched with `./swarm .` per the halt message's own instruction ("Fix the idle
   claim path, then relaunch with ./swarm").
4. Appended this evidence to `backlog/paused/BL-528-auto-heal-claim-without-progress.yaml`.
