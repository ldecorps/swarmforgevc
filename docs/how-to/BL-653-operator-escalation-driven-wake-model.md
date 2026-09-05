# Escalation-driven operator wake model (BL-653)

*How-to. Task-oriented: understand when the LLM Operator launches, when the
babysitter escalates to it, and what retired.*

The operator is **summoned, never scheduled**. Before BL-653, `operator_runtime.bb`
manufactured wake sources every tick (`dead-agent-events`, payload-free
`SWARM_CHECK_TIMER`), burning hundreds of pointless launches on healthy
mono-router nights. BL-653 retires those fabricated wakes and wires deterministic
escalation from the babysitter (BL-611).

The front-desk **restricted** operator (BL-334) is unchanged — this ticket
touches only the full operator runtime path.

## Legitimate wake sources

| Source | Event type | When |
| --- | --- | --- |
| Inbound human traffic | `TELEGRAM_TOPIC_MESSAGE`, `TELEGRAM_BL_TOPIC_MESSAGE`, `HUMAN_COMMAND` | Human posts in a topic or issues a command |
| Babysitter escalation | `BABYSITTER_ESCALATION` | A **CRIT** finding needs LLM judgement |
| Catastrophic control loss | `SWARM_CONTROL_LOST` | Unchanged from BL-368 |

Everything else that used to wake the operator on a timer — especially
payload-free `SWARM_CHECK_TIMER` patrols and per-tick `AGENT_EXITED` from
`dead-agent-events` — no longer launches the LLM.

## Babysitter: nudge vs escalation

The babysitter still owns deterministic health checks ([BL-611 runbook](BL-611-babysitterd-runbook.md)).

| Finding severity | Coordinator pane | Operator LLM |
| --- | --- | --- |
| **CRIT** | Nudge (existing) | **Escalation** — `BABYSITTER_ESCALATION` enqueued |
| **WARN** `stuck-*` | Nudge (existing) | No wake — below escalation bar |
| Other WARN / OK | Log only | No wake |

CRIT findings enqueue via `operator_enqueue_event.bb`:

```bash
bb swarmforge/scripts/operator_enqueue_event.bb <project-root> \
  '{"type":"BABYSITTER_ESCALATION","subject":"<finding-key>","detail":"<message>"}'
```

The script appends to the same `.swarmforge/operator/events.jsonl` queue
`operator_runtime.bb` already polls — one queue, one lock discipline.

A dormant mono-router role with no live session is **not** a CRIT death signal;
only a real resident process loss on the active role escalates (BL-647 pack
awareness + BL-653 escalation bar).

## Healthy unattended night

On a rotation-router night with:

- no Telegram traffic,
- green babysitter sweeps, and
- no CRIT findings,

the operator LLM launch count stays **zero**. This replaces the
`night-start.sh` operator pid-hold tourniquet — retired under BL-653.

If launches appear on a quiet night, check for:

1. Residual `SWARM_CHECK_TIMER`, `AGENT_EXITED` or `TASK_ARRIVED` events
   (regression — all three are retired tick sources).
2. Undelivered Telegram traffic waking the operator legitimately.
3. A CRIT babysitter finding you missed in `babysitterd.log`.

## Verify (fixture-backed)

Match the ticket QA procedure — use fakes, never a live overnight wait in CI:

```bash
bash swarmforge/scripts/test/test_operator_runtime_bl653_escalation_driven.sh
bash swarmforge/scripts/test/operator_lib_test_runner.bb   # BABYSITTER_ESCALATION cases
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-653-operator-wakes-only-on-real-events-escalation-driven.feature
```

Scenarios cover: zero launches on healthy nights, one run per Telegram message,
one run per escalation with finding text, coordinator-only nudge for sub-bar
WARN, real death vs dormant role, `SWARM_CONTROL_LOST` unchanged, front-desk
restricted operator byte-identical baseline, and pid-hold retirement.

## What retired

- **`dead-agent-events`** as a per-tick wake source — agent-death detection is
  the babysitter's job; it escalates only real deaths.
- **`SWARM_CHECK_TIMER`** as an LLM patrol — periodic health is deterministic
  (`babysitterd`); the operator no longer re-reads a healthy swarm every N
  minutes.
- **`night-start.sh` operator pid-hold** — cost on unattended nights now tracks
  real events only.
- **`TASK_ARRIVED`** as a per-tick wake source (BL-1353, human ruling
  2026-09-04) — it was never in the table above, but it was still manufactured
  every tick from a bare mtime probe on the coordinator's `inbox/new` that never
  asked whether the coordinator picked the handoff up. A handoff landing for the
  coordinator is ordinary pipeline motion the coordinator handles itself, not a
  finding that something is odd: on 2026-09-02 UTC it produced 37 of 73
  dispatched events, over half that day's disposable Opus sessions. An unclaimed
  handoff is still covered — by a babysitterd CRIT and BL-098 chase/nudge
  telemetry — so the invariant below holds. The freshness probe itself stays:
  the BL-307/BL-310 closing pass reads it to decide whether a hibernated swarm
  should wake for new coordinator mail.

## Invariant (do not violate)

The patrol wake is never removed before a live escalation producer exists. At
every commit in this ticket's history, either the old payload-free timer still
wakes the operator **or** `BABYSITTER_ESCALATION` is wired and proven end-to-end.

## Siblings

- [babysitterd runbook](BL-611-babysitterd-runbook.md) — checks, nudges, CRIT vs WARN
- BL-647 — rotation-aware liveness producer (lands before BL-653; this ticket retires the runtime-side per-tick wake fabric)