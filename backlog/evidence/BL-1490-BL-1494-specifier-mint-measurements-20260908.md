# Supervisor `alarm-and-halt stalled` kills the swarm: mint-time measurements (specifier, 2026-09-08)

Source: `backlog/INTAKE-operator-question-1788834810204.md` (operator, filed
02:33Z, commit `9e0e88777e`), plus the operator's
`backlog/evidence/handoffd-supervisor-alarm-halt-kills-whole-swarm-20260908.md`.
All timestamps UTC. Measured on main `0f1af215a4`.

The operator's framing, carried verbatim (Article 5.3 posture even though the
operator is an agent): "TWO SEPARABLE DEFECTS FOR TRIAGE: (1) the false stall
verdict itself (a progressing daemon judged stalled), and (2) the blast radius
+ silence: a supervisor halt should never take the tmux server and 9 agents
with it, and if it does it MUST write a kill-all-audit row and an
availability stop row so the death is visible rather than inferred from a log
grep." Minted as BL-1490 (1), BL-1491 (2, the silence) and BL-1492 (2, the
blast radius - a reversal of BL-144, pending the human). Two siblings found
underneath: BL-1493 and BL-1494.

## 1. Every halt on record, classified by the daemon's last log line

`ls .swarmforge/daemon/handoffd-failure-*.log` = 150 reports (2026-07-15 to
2026-09-08T03:44Z). For each, gap = `died_at` minus the timestamp of the last
daemon line the report captured, and kind = that line's tag.

| last line                | gap        | count | reading |
|--------------------------|------------|-------|---------|
| `startup-notify`         | 30-45 s    | 41    | startup-notify phase outran the 30 s window (un-markered) |
| `sweep-boundary`         | 225-234 s  | 35    | the sweep AFTER post-qa-branch-sweep (main-sync-deadlock-sweep) ran past the 225 s in-sweep budget, 09-06 21:52Z to 09-07 06:04Z, ended by the 06:12Z hand-clear |
| `stopped`                | 30-45 s    | 26    | the daemon itself exited (genuine :dead) |
| `ambulance-inactive`     | 30-45 s    | 15    | delivery phase, first delivery not yet complete (un-markered) |
| (no daemon lines)        | 30-45 s    | 14    | July reports, pre-BL-967 logging |
| `delivered`              | 30-45 s    | 8     | delivery phase mid-burst (un-markered) - ALL since 2026-09-07T19:44Z |
| `claim-progress-email`   | 45-300 s   | 5     | July email sends |
| `heartbeat`              | 30-45 s    | 1     | 09-07 18:03:30Z: cycle-end heartbeat written 74 ms AFTER the verdict, delivery burst before it |
| other                    |            | 5     | |

Un-markered-phase false positives: 41 + 15 + 8 + 1 = **65 of 150**. The 35
over-budget halts are the BL-977 invariant-2 path doing what it says (a sweep
past budget IS stalled) on a sweep that was wedged in the main-sync deadlock;
they stopped with the hand-clear and are not this mint's subject.

## 2. The live shape (7 halts, 2026-09-07T18:03Z to 09-08T03:44Z)

`handoffd-failure-20260908T034428Z.log`, verbatim tail:

```
03:43:53.685 heartbeat cycle=0
03:43:54.686 heartbeat cycle=1-start
03:43:54.686 ambulance-inactive mode not engaged
03:44:00.815 delivered .../coordinator/outbox/10_20260908T034348Z_007318_from_coordinator_to_cleaner.handoff
03:44:10.019 delivered .../10_20260908T034349Z_007319_from_coordinator_to_architect.handoff
03:44:19.277 delivered .../10_20260908T034350Z_007320_from_coordinator_to_hardender.handoff
03:44:25.714 delivered .../10_20260908T034351Z_007321_from_coordinator_to_documenter.handoff
died_at: 03:44:28.606  reason: stalled   coordinator outbox=1 (the fifth note, written 03:43:52Z)
```

At 03:44:28.6: heartbeat file age 33.9 s (> 30 s; written at cycle start,
`handoffd.bb` loop head, BL-789), oldest pending outbox 36 s (> 30 s), sweep
marker `{"sweep":"idle"}` (cooldown-sweep set it idle at 03:43:53.685;
`poll-once!` publishes nothing). `evaluate-health`
(`handoffd_supervisor.bb:155-198`): in-flight? false, effective heartbeat age
33.9 s > 30 s, pending outbox > 30 s -> `:stalled`. The 02:30:29Z, 03:21:16Z
and 01:47:12Z reports are byte-for-byte the same shape (3 to 4 `delivered`
lines at 6-11 s spacing after `cycle=N-start`). The 03:21:16Z halt killed the
previous specifier session mid-mint (`acceptance-lane-sweep-unowned-reds-
adjudication-specifier-20260908.md`).

Why the phase is un-markered: `handoffd.bb:4958-4966` sets
`daemon-cycle-guard-lib/current-context` to "delivery" / "canary-sweep"
(in-memory only, BL-967 attribution) and calls `poll-once!` / `canary-sweep!`
directly; only `run-sweep!` (`daemon_cycle_guard_lib.bb`, BL-977) publishes
`.swarmforge/daemon/handoffd.sweep-marker`. `startup-notify-pending!`
(`handoffd.bb:641`) runs before the loop with the same gap; the 09-02 startup
grace (`27d6ab8630`) covers only daemon age <= 30 s.

## 3. Why a delivery costs ~9 s, and why there are four or five of them

Per delivery (`deliver!`, `handoffd.bb:536-589`): `latest-role-usage-from-
context-events` (`llm_cost_ledger_lib.bb:53`) reads the WHOLE
`.swarmforge/telemetry/context-events.jsonl` through `read-events!`:

```
$ ls -la .swarmforge/telemetry/context-events.jsonl   -> 67 380 109 bytes, 258 157 rows
$ bb -e '(load-file "swarmforge/scripts/llm_cost_ledger_lib.bb") ... (latest-role-usage-from-context-events ".swarmforge" "cleaner")'
ms= 3104   (bb start-up ~0.3 s of that)
```

~3 s per recipient, growing with every event ever recorded (BL-1476's shape).
The rest is `recipient-pane-busy?` (a capture-pane) plus
`agent_runtime_inject.bb/notify-agent!` (inject, submit, 150 ms confirm polls,
up to 3 attempts). -> BL-1493.

The burst is the post-QA branch sweep's own notes. `post-qa-branch-sweep-tell!`
(`handoffd.bb:4192`) sends one `note` per surfaced (role, reason) via
`swarm_handoff.bb` with `SWARMFORGE_SKIP_SYNC_INJECT=1` for every reason but
dirty-worktree (BL-1361 human ruling: "Wake only for a dirty worktree and
defer the other reasons"). The env var suppresses only the SENDER's sync
inject; `maybe-notify!` (`handoffd.bb:456-497`) has no arm for it and injects
the standard wake for every new delivery. Measured 2026-09-08 00:00-03:52Z:

```
coordinator/sent to_cleaner 27, to_architect 29, to_hardender 21, to_documenter 22, to_coder 22
cleaner inbox/completed "branch behind" notes today: 28
.worktrees/cleaner log: "Merge main <sha> into cleaner." at 03:44, 03:49, 03:52, 03:57Z ... one per note
.swarmforge/daemon/wake-dedup/cleaner.json lastInjectedAtMs=1788839834313 (04:57:14Z)
```

Each landed bookkeeping commit (approval flips, topic records: the last five
commits on main are all `Approve BL-...` / `BL topic record`) makes every
role with its own commits divergent again; BL-1421's standing surfacing
clears as soon as the role merges (which the wake makes it do), so the next
landed sha re-tells. Four to five wakes and merge-up turns per landed commit,
~35 turns/hour across the pipeline. -> BL-1494.

## 4. The halt's silence and blast radius

`halt-swarm!` (`handoffd_supervisor.bb:539-556`) touches the stop file, TERMs
the daemon and runs `swarm-cleanup.sh <socket> <window-ids> <sessions>`, which
kill-sessions every role and closes the terminal windows. Nothing in that path
writes `.swarmforge/daemon/kill-all-audit.log` (writer: `kill_pipeline_swarm.sh:83`,
last row 2026-09-07T06:12:37Z) or an availability `stop` record (writer:
`availability_ledger_lib.sh/availability_record`, called only from
`kill_pipeline_swarm.sh:161`; today's ledger holds a `heartbeat-inferred` stop
at 00:00:00Z and a `start-swarm.sh` start at 00:00:02Z - nothing for the four
deaths). Recovery today: `babysitterd.log` 03:47:33Z `REPAIR [repaired]
control-plane - ./swarm ensure` -> 03:52:38Z `OK all checks green`, i.e. ~8 min
of total death per halt, nine agents' context gone, and the human gate BL-144
designed for never fires. -> BL-1491 (records), BL-1492 (restart in place,
human decision).
