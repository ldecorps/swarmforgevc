# Intake: TASK_ARRIVED wakes the LLM Operator on ordinary coordinator traffic - retire or gate it (human directive)

Filed by the Operator (2026-09-03, human-directed via Claude Code). The human
asked whether the Operator wakes on a cron or on babysitterd's word, and wants
it to wake when babysitterd finds something odd with the swarm - which is
already the BL-653 model. The gap is one wake source that is NOT in BL-653's
table of legitimate sources and produced half of yesterday's wakes.

## Measured (dispatched events, 2026-09-02 UTC, .swarmforge/operator/events-done)

| source | wakes |
|---|---|
| `TASK_ARRIVED` ("a handoff landed for the coordinator within the last interval", operator_runtime.bb:1713) | 36 |
| `BABYSITTER_ESCALATION` (CRIT findings) | 31 |
| `SWARM_CONTROL_LOST` | 4 |

BL-653's legitimate sources are: inbound human traffic (`TELEGRAM_*`,
`HUMAN_COMMAND`), `BABYSITTER_ESCALATION`, `SWARM_CONTROL_LOST`. `TASK_ARRIVED`
is ordinary pipeline motion the coordinator handles itself; it is not a
finding that "something is odd". Each wake is a disposable Opus session.

## Ask (direction, not mandate)

Retire `TASK_ARRIVED` as an LLM wake source, or gate it so it only fires when
the arriving handoff is one the coordinator did NOT pick up within its own
claim window (i.e. it becomes a babysitter-style finding, deduped with the
same 30-min cooldown). Same shape as BL-653's retirement of
`SWARM_CHECK_TIMER` / per-tick `AGENT_EXITED`: keep BL-653's invariant - a
live escalation producer (babysitterd CRIT) exists, so removing this wake
loses no coverage. Update the BL-653 how-to table either way so the documented
source list matches the code.

Not in scope: babysitterd's CRIT catalogue or its 300 s cadence - those are
right; this is only the non-escalation wake.

By operator.

---

## Drained 2026-09-03 by the specifier → **BL-1353**

Specced as `backlog/paused/BL-1353-task-arrived-is-not-an-escalation.yaml`
(`type: defect`, `severity: medium`, epic `swarm-reliability`), acceptance at
`specs/features/BL-1353-task-arrived-is-not-an-escalation.feature`.

Every premise in this intake was re-verified against code and data rather than
taken on trust, and the counts were recounted independently: 37 / 32 / 4 across
60 dispatch files for 2026-09-02 UTC (this intake said 36 / 31 / 4, filed
minutes earlier — the drift is just elapsed time). `TASK_ARRIVED` is confirmed
absent from the BL-653 how-to's source table, and still live in
`tick-observed-events`.

One thing found beyond this intake and carried into the ticket as an invariant:
`coordinator-inbox-has-fresh?` has a **second** consumer — `closing-pass-sweep!`
reads it as `fresh-coordinator-mail?` for the BL-307/BL-310 hibernation
decision. Changing the probe itself, rather than the wake path, would silently
alter hibernation.

The retire-or-gate choice is posed to the human as `ruling_options` on the
ticket, with the size difference between the two spelled out (retire is a few
lines; gate needs a claim-window concept that does not exist yet).
