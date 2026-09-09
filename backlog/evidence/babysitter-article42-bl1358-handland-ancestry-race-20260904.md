# Article 4.2 escalation on 485fd43bce (BL-1358) — FALSE POSITIVE (ancestry race)

Recorded by the Operator at 2026-09-04T17:05:33Z (UTC). No action taken beyond this note.

## Escalation

`BABYSITTER_ESCALATION` / `pipeline-code-on-main-485fd43bcea71ebfec81d9b430fc18553b440440`:

> pipeline code landed on main outside QA (Article 4.2/BL-247) ... touches
> extension/test/bl1358MutantTimeCeilingInvariants.property.test.js,
> specs/pipeline/steps/bl1358MutantTimeoutKilledSteps.js

## Verdict: approved, not a violation

`swarmforge/scripts/is_qa_ancestor.sh 485fd43bce...` → **rc=0** (ancestor of
`swarmforge-QA` AND no bounce verdict in either store). The commit is
QA-approved pipeline code. Nothing escaped review.

## Root cause: an 8-minute ancestry window, not a permanent flag

This is the QA hand-build/hand-land route (BL-1376 recipe, BL-1241 remedy).
That route pushes to `origin/main` FIRST and merges back into
`swarmforge-QA` AFTERWARDS, so the ancestry-only predicate reads the sha as
unapproved for the gap between the two:

| UTC | event |
|---|---|
| 16:54:32Z | `485fd43bce` "BL-1358: tip-pure hand-built replay onto origin/main" lands on main |
| ~16:55–17:02Z | **babysitter fires Article 4.2** — sha not yet reachable from `swarmforge-QA` |
| 17:02:59Z | `swarmforge-QA@{18:02:59 +0100}: merge origin/main` — sha becomes a QA ancestor |
| 17:03:09Z | QA commits BL-1358 land-success evidence |
| 17:04:04Z | BL-1358 closed → `backlog/done` |

So the standing note "Art 4.2 is ancestry-only — QA hand-land ALWAYS flags"
is sharper than previously recorded: the flag is a **race window**, not a
permanent state. Re-running `is_qa_ancestor.sh` after QA's merge-back
clears it every time. Any future fix should either delay the gather past
QA's merge-back or treat "QA's own hand-land evidence commit exists" as
approval.

## Swarm health at the time of this escalation

8 role panes live; `handoffd` heartbeat fresh (17:03:56Z); HEAD advancing
(commits at 17:04:08Z); `main-sync-deadlock.json` is `{}` (the 08:33
latch the coordinator asked about has cleared on its own — it merged
`origin/main` at 17:03:18Z and closed BL-1358). Local main is 16 ahead of
`origin/main`, which is exactly BL-1390's subject and already an active
ticket. Nothing to nudge.
