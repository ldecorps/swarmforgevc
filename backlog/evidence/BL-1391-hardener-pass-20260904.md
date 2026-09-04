# BL-1391 — hardener pass, 2026-09-04

Merged architect re-review commit `3b8bebf01b` (COMPLIANT — D1 confirmed
non-flaky over 19+ consecutive clean runs; a byproduct BL-1392
`handoffd.bb` forward-reference defect found and fixed via this ticket's
own real-daemon-tick e2e, independently verified —
`backlog/evidence/BL-1391-architect-pass2-20260904.md`).

## Merge conflicts

- `handoffd.bb`: this chain independently discovered and fixed the SAME
  `read-json`/forward-reference defect I found and fixed in my own BL-1392
  pass this session (`631a5b4552`), via a different route (BL-1391's own
  e2e running a real daemon tick, rather than
  `test_handoffd_push_sweep_wiring.sh`). Took the BL-1391 chain's version:
  functionally equivalent, but cleaner (`fs/exists?` guard ahead of `slurp`
  rather than relying on the exception path for the common "no state file
  yet" case) and carries a fuller explanatory comment on why placement
  relative to `send-push-alarm-email!` is load-bearing under SCI.
- `test_bl1363_close_ticket.sh`: kept my own `"$@"` argv-threading fix
  (theirs was the pre-fix state on this one line — same file, unrelated
  region, no functional overlap).
- `suite-manifest.tsv`: union (added `test_bl1391_bookkeeping_conflict.sh`).

Confirmed post-merge: `handoffd.bb` loads clean
(`bb -e '(load-file ...)'`, no error), `bash -n` on the close-ticket suite
OK.

## Checks re-run, all independently

- `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS.
- `bl1391_bookkeeping_conflict_property_runner.bb` — ALL PROPERTIES HOLD
  over 515 constructed cases.
- `test_bl1391_bookkeeping_conflict.sh` — 4 consecutive runs, ALL PASS
  each (matching the architect's own non-flakiness discipline given this
  ticket's bounce history).
- `run_acceptance.sh` on the BL-1391 feature — 6/6, three times.
- `check_feature_handler_registration.sh` — rc 0.
- required_wiring anchors grepped directly: `bookkeeping-conflict` literal
  present at `handoffd.bb:3519/3531/3552/3558` (the daemon's own log
  lines, both refused and resolved paths); `registerSteps` exported from
  `bl1391BookkeepingConflictResolvedSteps.js:81/171`.

## BL-149 cooldown gate

- `master_main_reconcile_lib.bb`, `handoffd.bb` — both DECISION:
  skip-cooldown (still actively churning this session). No fresh
  hand-authored mutation sweep this pass per the gate; the existing unit
  runner (all pass), property runner (515 cases), e2e (4/4 clean) and
  acceptance (6/6 x3) coverage stands.

## BL-113 Gherkin mutation

One `Scenario Outline` present (`an evidence file is resolved only when
both sides merely appended`). Ran the real mutation pass (not a soft
re-run over an unchanged stamp): 4/4 mutants killed, 0 survived, 0 errors,
`"outcome": "pass"`. Confirmed against the authoritative source per BL-460
discipline — the embedded manifest in the feature file itself
(`acceptance-mutation-manifest-begin`/`-end`), not a stdout summary line:
`{"Total":4,"Killed":4,"Survived":0,"Errors":0}`. A follow-up soft re-run
correctly reported `SkippedScenarios:1 SkippedMutations:4` (the stamp was
already valid) — read as confirmation per BL-460, not as a broken tool.

## CRAP / DRY

`git show --stat 3b8bebf01b` touches no file under `extension/src` — N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation-worker processes after the Gherkin
mutation run (confirmed via `ps`/`pgrep` after completion; the one node
process observed mid-run had already exited by the time it was checked).
No stray `/tmp` mutation-work directories left behind — swept the ones
this pass's runs created (`/tmp/tmp.*` with a `mutations/` subdir).

## Result

Merge resolved by comparing content (not picking a side blind); this
ticket's own three invariants and both required_wiring anchors
re-verified clean across unit, property, e2e (4x), acceptance (3x), and
Gherkin mutation. Forwarding to documenter.

By hardender.
