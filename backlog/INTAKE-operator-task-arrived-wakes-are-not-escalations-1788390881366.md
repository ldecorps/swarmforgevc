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
