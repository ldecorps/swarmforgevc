# BL-943 hardener pass — 2026-08-19

## Reviewed commit
`02a11fe498` ("BL-943: architect pass - both invariants hold, verified
against real organic flakes"), merged into hardener as this parcel.

## Tooling scope check
No `extension/src/*.ts` touched (the one JS file is the acceptance step
handler, IO-driving). Stryker/CRAP/DRY inapplicable. All six fixed files
are bash — no mutation/CRAP/DRY tool wired at this boundary; gated by
their own suites plus the coder-authored property test (the accepted
form for this gap, per this session's precedent).

## Host load — this pass ran under the most extreme conditions this
session has seen: load average climbed from 130 to 160+ on 4 cores
(40x cores) WHILE this review was in progress. The BL-149 cooldown gate
reported `skip-busy`/`skip-cooldown` on every changed file at the start
of the pass. Given this, and given the architect ALREADY ran all six
live daemon-spawning scripts plus the full 9-scenario acceptance feature
successfully on this same host (including catching two REAL organic
`rm -rf` failures live, not just simulated ones — the strongest possible
evidence this fix works), I deliberately did NOT re-run the six live
scripts or the acceptance feature myself: at 40x core count, a live
daemon fixture run risks a multi-minute-plus stall for marginal
additional confidence over what the architect already captured in the
wild. This is the load-based deferral engineering.prompt directs
("wait for it to subside or fall back to targeted tests instead of
assuming a stuck run is a code defect"), applied to a live-fixture
re-run rather than to a mutation tool specifically, since the load rules
bind every heavy run, not Stryker alone.

## Checks run (complete inventory, not first-failure-stop)

1. **Lightweight, no-daemon-spawn re-run** (safe at any load — pure bash,
   no subprocess fixtures): `bash
   swarmforge/scripts/test/bl943_cleanup_wrapper_property_test.sh` —
   **320/320 trials pass**, independently reconfirmed, not trusted from
   either evidence file.
2. **Independent code-level audit of all 18 call sites across all six
   files** (own hardening judgment, cheap and load-independent): counted
   `local exit_code` captures and `WARN: cleanup could not remove`
   lines per file via direct grep, cross-checked against the ticket's
   own call-site table:
   ```
   aged_note_rotate:      2 captures / 2 warnings (ticket: 2)
   ambulance:              2 captures / 2 warnings (ticket: 2)
   priority_rotate:        4 captures / 4 warnings (ticket: 4)
   rule_proposal_rotate:   3 captures / 3 warnings (ticket: 3)
   starve_rotate:          4 captures / 4 warnings (ticket: 4)
   wake_attribution:       3 captures / 3 warnings (ticket: 3)
   ```
   Every site matches exactly — the fix is complete across all 18 call
   sites in all six files, not a subset. Read two files in full
   (`test_handoffd_aged_note_rotate_wiring.sh`,
   `test_handoffd_ambulance_wiring.sh`) and confirmed both cleanup
   functions capture `$?` as the FIRST executable statement (before the
   `kill`, before the `rm -rf`), guard the fallible `rm -rf` inside an
   `if`, and `return "$exit_code"` explicitly as the last statement —
   the exact mechanism the architect independently verified with a
   standalone bash reproduction.
3. **Required wiring**: `bl943FixtureCleanupVerdictSteps` confirmed
   present in `specs/pipeline/steps/index.js`'s `DOMAINS` array (grepped
   directly).
4. **Process/leak check**: no leftover `bb handoffd` fixture processes
   from earlier runs (architect's own live runs already completed and
   cleaned up before this pass began); `git status --short` clean.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling. The two live
verification layers (six real scripts + acceptance feature) were left to
the architect's own already-thorough, already-successful run — including
two genuinely organic cleanup failures caught live — rather than
re-attempted at 40x-core host load, which is a deliberate, load-aware
deferral rather than a skipped check. Everything safely re-runnable at
this load (the property test, a full code-level audit of every one of
the 18 fixed call sites) was independently re-verified and matches the
ticket's own scope exactly.

Forwarding to documenter.

By hardener.
