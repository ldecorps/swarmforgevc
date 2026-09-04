# BL-1366 — hardener pass, 2026-09-04

Merged architect commit `b7bfd08199` (COMPLIANT, clean sweep — dependency
gate, logical coupling, and all three invariants verified directly in
`land_main_publish.sh`'s code, not from evidence alone —
`backlog/evidence/BL-1366-architect-20260904.md`). Clean merge, no
conflicts.

## Checks re-run, all independently

- `test_bl1366_land_is_one_command.sh` — 3 consecutive standalone runs,
  ALL PASS each (matching the architect's own 3x re-run discipline for a
  script that pushes to a real shared `main`).
- `run_acceptance.sh` on the BL-1366 feature — 9/9 pass.
- `check_feature_handler_registration.sh` — rc 0.
- `required_wiring`: none declared, per the ticket's own note (no
  production anchor exists yet — QA wiring to this path is BL-798, out of
  scope here), same pattern already accepted for BL-1361/BL-1362.

## BL-149 cooldown gate

`land_main_publish.sh` — DECISION: skip-cooldown (still actively churning
today). No fresh full hand-authored mutation sweep required by the gate
this pass. Given the production stakes (this script pushes directly to
the shared `origin/main`), independently spot-checked the single
highest-consequence invariant anyway rather than trusting the coder's own
break-then-fix account alone: hand-mutated `land_push_ff_only()` to add
`--force` to its `git push`, re-ran the real e2e suite against the
mutated script — FAILED (exit 1, "no push used force"-class assertion
caught it) — confirming the no-force-push guard is genuinely load-bearing
and not a vacuous check. Restored the file, diffed byte-identical against
a pre-mutation backup.

## BL-113 Gherkin mutation

One `Scenario Outline` present (`the lock is released whatever ends the
land`). Ran the real mutation pass: `"outcome": "pass"`. Confirmed against
the embedded manifest per BL-460 discipline:
`{"Total":4,"Killed":4,"Survived":0,"Errors":0}`.

## CRAP / DRY

`git show --stat b7bfd08199` touches no file under `extension/src`. N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes. Hand-mutation backup file
removed after use. No stray fixture directories left behind (the e2e
suite's own origin-URL/no-live-remote checks, re-verified passing, cover
this directly).

## Result

All three of this ticket's declared invariants re-verified: never
force-push (independently spot-mutated and confirmed the guard catches
it), lock released on every exit path, `LAND_ESCALATE` never
auto-resolved. Acceptance and BL-113 both clean. Forwarding to
documenter.

By hardender.
