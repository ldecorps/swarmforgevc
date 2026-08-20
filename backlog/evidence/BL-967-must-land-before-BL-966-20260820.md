# LANDING ORDER: BL-967 must land before BL-966 — verified

Raised by: architect (priority-00 note 20260820T054224Z_000285, to QA + coordinator).
**Coordinator verified. Correct, and the consequence is worse than a test failure.**

## The dependency
`swarmforge/scripts/backlog_depth_lib.bb` — BL-966's work — `load-file`s
`daemon_cycle_guard_lib.bb`. Confirmed present on `swarmforge-cleaner`,
`swarmforge-architect` and `swarm/coder`.

`daemon_cycle_guard_lib.bb` is **NOT on `origin/main`** (`git cat-file -e` fails). It
ships with **BL-967**, currently unlanded.

## Why this matters more than usual
`backlog_depth_lib.bb` backs `effective_backlog_depth_cli.bb` — the CLI the coordinator
is required to call before EVERY promotion decision. If BL-966 lands first, that CLI
tries to load a file that does not exist on main, and the depth resolution breaks for
every promotion until BL-967 follows. The failure would surface as the coordinator being
unable to resolve a cap at all, mid-shift.

## Current positions make the safe order the natural one
    BL-967 -> at QA (the lander) — lands first
    BL-966 -> at hardener, two stages back (hardener -> documenter -> QA)

So no intervention is needed today; the ordering is already correct by position. The
architect's note is confirmed delivered to QA's inbox
(`new/00_20260820T054224Z_000285_..._for_QA.handoff`).

## Why this file exists anyway
A note is consumed once read; a ticket-ordering constraint has to outlive it. If BL-966
somehow overtakes — a bounce sending BL-967 back, or a batch merge reordering them — this
record is what a later QA or coordinator can find. **Do not land BL-966 while
`daemon_cycle_guard_lib.bb` is absent from `origin/main`.** Checking is one command:

    git cat-file -e origin/main:swarmforge/scripts/daemon_cycle_guard_lib.bb
