# BL-967 qa_e2e step 3 (30-min daemon soak) is OWED but CANNOT START yet

QA note 20260820T054549Z_000400 correctly says the soak is owed now that BL-967 has
landed. Coordinator checked the precondition. **It is not met.**

## Measured 2026-08-20 05:50Z
    BL-967 on origin/main:  YES  (a5ecfc281b, QA pass inventory)
    BL-967 on LOCAL main:   NO
    divergence:             10 ahead / 27 behind origin/main
    running handoffd sha:   22544178a  ("BL topic record for BL-963") - predates the fix
    handoffd pid age:       46s, state R   (still flapping)
    heartbeat cycles logged: 1            (unchanged - the stall signature)

The daemon is launched from this checkout (`/Users/ldecorps/projects/swarmforgevc`). The
fix is not in this checkout, so every flap-restart re-arms **pre-fix** code. A soak run
now would measure the OLD daemon and report a false failure against a fix that was never
loaded.

## What unblocks it
Local `main` must take `origin/main` (27 behind). Once it does, the daemon picks the fix
up on its own next flap-restart within minutes - no BL-328 sync needed, and none is
possible anyway while `daemon_log_freshness.conf` sits uncommitted (third block tonight).

The coordinator has NOT performed this merge unprompted. One was performed earlier
tonight only because the reference-freshness guard refused to dispatch any turn without
it; that is a different situation from merging to advance a ticket's verification, which
sits closer to the integration work Article 1.1 reserves for QA. Surfaced to the operator
for a decision rather than assumed.

## How the soak should be measured when it can run
No polling required, and none should be added: the babysitter's
`handoffd.log silent >300s` sweep IS the instrument. After the fix is live, those alerts
either stop (soak passes) or keep arriving (fix ineffective). The coordinator reports on
the next sweep either way.

## Standing caution
Do not record step 3 as passed on the basis of a quiet interval measured BEFORE the fix
is in the running daemon. Check `git merge-base --is-ancestor a5ecfc281b <running_sha>`
first.

## Follow-up: nothing tracks the owed soak (documenter note 20260820T…, priority 20)

BL-967 is **closed to `done/M8`** with `qa_e2e` step 3 unfulfilled, and no ticket carries
it. Step 3's own text confirms the precondition this file documents:

> "3. Live soak (read-only observation): **after the parcel lands and the daemon restarts
> on it**, `.swarmforge/daemon/freshness-incidents.log` gains ZERO new handoffd restart
> entries over a 30-minute window while the swarm is active, and handoffd.log shows
> completed cycles"

So the step was written expecting exactly the gap that now exists — it cannot run until
the daemon is actually executing the fix, which it is not.

**On the close.** The coordinator closed BL-967 on QA's `git_handoff` approval, which is
the documented trigger; the close gate requires a QA approval referencing the ticket and
nothing more. It does **not** verify that `qa_e2e` steps completed. QA approved and landed
first, then separately reported step 3 as owed. So the close was procedurally correct and
still left a verification orphaned — that combination is the point worth recording, not
the individual actions.

Consequence if unaddressed: should the soak later fail, nothing reopens BL-967, and the
handoffd stall would be believed fixed on the strength of a landing rather than a
measurement. Routed to the specifier to decide whether this warrants a small tracking
ticket or an amendment to the close gate; the coordinator does not mint.
