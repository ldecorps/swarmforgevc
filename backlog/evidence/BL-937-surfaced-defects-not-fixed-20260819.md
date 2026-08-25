# BL-937 — two real defects surfaced by the port, not fixed here (2026-08-19)

BL-937's own constraints are explicit: *"If a ported test turns out to FAIL
on a real assertion once it can finally execute, that is a SEPARATE defect
that this port has surfaced, not part of this parcel. Record it with
evidence and raise it; do not fix it here and do not weaken the assertion
to make the port look clean."* This file is that record, for both defects
the port surfaced. Neither is a defect in the mapfile/`${var^^}` port
itself — both are pre-existing, real, previously-unreachable-on-this-host
failures.

## D1 — test_handoffd_aged_note_rotate_wiring.sh's fixture never declares a rotation-router pack

**Reproduced**: `/bin/bash swarmforge/scripts/test/test_handoffd_aged_note_rotate_wiring.sh`,
twice, both times identical:

```
FAIL: A: the resident was never rotated to specifier for its aged note (log: ...
...
2026-08-19T05:2x:xx.xxxxxxZ chase-rotate-redirect specifier cleaner
2026-08-19T05:2x:xx.xxxxxxZ chase-rotate-error cleaner not-a-rotation-router
2026-08-19T05:2x:xx.xxxxxxZ chase-rotate-error cleaner not-a-rotation-router
```

**Root cause**: `setup_common_fixture` in this file (unlike its
`test_handoffd_priority_rotate_wiring.sh` and
`test_handoffd_starve_rotate_wiring.sh` siblings, both of which already
write `config rotation router` into their fixture conf) never declares the
fixture pack a rotation router. BL-931 (landed 2026-08-19, same day as this
port) added a gate refusing `rotate-resident-to!` outright on a
non-rotation-router pack. handoffd's own chase sweep drives this daemon
path directly (`handoffd.bb`'s `chase-rotate` call), so every attempted
rotation in this test's Scenario A refuses with `not-a-rotation-router`,
the resident never actually rotates to specifier, and the test's own
40-second poll for `chase-rotate specifier` in the daemon log times out and
fails.

This is the exact class of defect BL-936 (same day) fixed for BL-805's own
JS property fixture, and the exact class the sibling shell fixture
`test_rotate_to_role_stuck_parcel_gate.sh` was already amended for when
BL-931 landed. This file was never amended because it could not run at
all - it died on `mapfile: command not found` at line 132, before ever
reaching the daemon or the pack gate.

**Why not fixed here**: BL-937's own scope is the six named bash-3.2
portability sites (`required_wiring` also pins this: "adjusting assertions
or comments alone leaves the lane red... A port preserves behaviour
exactly", invariant 2: "no production logic is rewritten while passing
through" - and while a test FIXTURE isn't production logic, the ticket's
constraints separately and explicitly reserve any REAL-assertion failure a
restored test surfaces for a follow-up ticket, not this parcel). Declaring
`config rotation router` in this fixture is a one-line fix (same shape as
BL-936's), but it is not this ticket's fix to make.

**Verified the port itself is not the cause**: the failure is a
`rotate-gate-decision` refusal (`not-a-rotation-router`), unrelated to how
`FIXTURE_A`/`FIXTURE_B` get populated from `setup_common_fixture`'s stdout
(mapfile vs. the portable read-loop). The daemon starts, reads the fixture
mailboxes, and attempts the rotation correctly - it is refused for a reason
entirely orthogonal to array-reading semantics. `test_handoffd_priority_rotate_wiring.sh`
and `test_handoffd_starve_rotate_wiring.sh` - whose fixtures DO declare the
pack a rotation router - both pass 4/4 clean.

## D2 — stabilize-two-pack.conf profile is missing its `window coordinator` line

**Reproduced**: `/bin/bash swarmforge/scripts/smoke_check_stabilize_two_pack.sh`:

```
SMOKE FAIL: profile defines roles [coder cleaner], expected [coordinator coder cleaner] (coordinator+coder+cleaner only, per BL-203 scope)
```

**Root cause**: `swarmforge/profiles/stabilize-two-pack.conf` currently
declares only two `window` lines:

```
window coder claude coder --model claude-opus-4-6 --dangerously-skip-permissions --effort high --remote-control SwarmForge-Coder
window cleaner claude cleaner batch --model claude-sonnet-5 --dangerously-skip-permissions --effort medium --remote-control SwarmForge-Cleaner
```

No `window coordinator ...` line exists at all. The smoke check's own
BL-203 scope statement (its `expected=(coordinator coder cleaner)` array,
and its own failure message) says the profile must declare exactly these
three roles - the profile and its own smoke check have drifted apart, and
nothing caught it because the smoke check itself could not run
(`mapfile: command not found` at line 27, before ever reaching the
comparison).

**Why not fixed here**: same reservation as D1 - a real, substantive,
previously-unreachable assertion failure this port surfaced, not a defect
in the port. Whether the fix is adding the missing `window coordinator`
line to the profile, or the smoke check's own expectation is stale, is a
judgement call for whoever picks this up to make after reading BL-203's own
scope statement - not assumed here.

**Verified the port itself is not the cause**: `roles=()` from the portable
read-loop reads exactly the same two role names (`coder`, `cleaner`) `grep
-E '^window ' | awk '{print $2}'` finds in the file today - confirmed
directly via `grep -n '^window ' swarmforge/profiles/stabilize-two-pack.conf`.
The array-reading port is not what is missing; the profile's third line is.

## Disposition

Both raised via a priority-00 `note` to the specifier and coordinator
alongside this parcel's `git_handoff`, per the ticket's own instruction and
the workflow rule that a spec gap/surfaced-but-out-of-scope defect leaves
by `note`, never folded into a parcel. Neither blocks BL-937 itself: the
port is complete and correct for all twelve `mapfile` sites and two
`${var^^}` sites across the six named files, verified independently of
these two pre-existing fixture/profile gaps.
