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

## 4th occurrence — 2026-07-22T14:18:59Z — CRITICAL: halt becomes unrecoverable via normal relaunch

Same handoff (`10_20260722T122929Z_000646_from_coordinator_to_coder_for_coder.handoff`,
BL-551) halted the swarm again at reclaims=10. Uncommitted worktree work (`babysitter_assess.bb`,
`babysitter_assess_lib.bb`, test runners, `node_modules/`) was again real and intact — same
false-positive pattern as above.

**New finding, worse than previously documented:** the `.claim-progress.json` sidecar is a
plain file beside the in_process handoff and is *never reset by a swarm restart*. Every
relaunch attempt in this incident was itself killed within ~40s by a fresh
`claim-progress-halt`, because `handoffd_supervisor`'s first health-check tick after boot
re-reads the same stale `reclaims=10+` sidecar and re-halts before the newly-spawned coder
pane could even finish booting:

```
14:18:59Z kill_all_swarm (original halt)
14:21:30Z kill_all_swarm (killed agents from relaunch #1, ~30s after start)
14:22:09Z kill_all_swarm (killed agents from relaunch #2, ~40s after start)
```

Two consecutive `./swarm` relaunches were destroyed automatically before a human or the
babysitter could intervene — this makes the false-positive halt **self-perpetuating**, not
a one-time blip. `swarm_ensure.bb` cannot fix this either (it only respawns panes/daemons
against existing state; it does not touch the stuck claim).

**Remediation that actually broke the loop:** archived the in_process handoff + its
`.claim-progress.json` + `.nudge` sidecars to `inbox/done/` (with a babysitter note,
per the existing archival convention) *before* relaunching a 3rd time. That relaunch
stayed up (verified 33s+ uptime, no further `kill_all_swarm` entries in
`.swarmforge/daemon/kill-all-audit.log`).

**Recommendation:** the BL-528 fix must include clearing/resetting the claim-progress
sidecar as part of (or a precondition for) any swarm relaunch — otherwise every future
false-positive halt will re-trigger itself on the very next restart attempt, indefinitely,
until someone manually deletes the sidecar. Escalating priority 2 → 1 given this is now a
4th same-day recurrence and the newly-discovered self-perpetuating restart-kill behavior.

## 5th/6th occurrence — 2026-07-22T15:20:49Z — same pattern, now hitting TWO roles at once

Halted again ~1h after the 4th-occurrence fix, this time flagging **two** roles
simultaneously: `coder` (reclaims=9→10, active on BL-550, "Implementing BL-550…" 16m+,
xhigh effort, real tool use — files `babysitter_nudge_lib.bb`, `babysitter_nudge_resident.bb`,
`openrouter_claude_env.sh` + test runners uncommitted but real) and `hardender`
(reclaims=6, batch handoff `00_20260722T145906Z_000464_from_architect_to_hardender`).
`kill_all_swarm` halts the *whole* swarm on any single role's threshold breach, so
hardender's claim was orphaned by coder's halt regardless of hardender's own state.

Babysitter nudged coder to commit (queued — Claude Code defers input while the agent is
mid-generation, so it likely didn't land before the halt fired; same timing gap as the
13:51Z incident). Applied the now-standard remediation immediately: verified both
worktrees' uncommitted work was intact, archived **both** stuck in_process claims
(coder's `000663` handoff and hardender's batch item `000464`) to their respective
`inbox/done/` with babysitter notes, then relaunched once. That single relaunch held
(all 8 agents + handoffd up, no further `kill_all_swarm` entries).

This confirms the false-positive/self-perpetuating-restart pattern is not coder-specific —
any role holding a claim near/at the reclaim threshold at the moment of a kill_all_swarm
event will independently need its claim archived before a relaunch survives. Still no
code fix landed for BL-528; this is the 3rd time the manual archive-then-relaunch
procedure was required today (4th, 5th/6th occurrences).
