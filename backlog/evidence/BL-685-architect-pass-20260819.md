# BL-685 architect pass — 2026-08-19

Reviewed commit: 7f3413a530 (via cleaner's merge 86d60aab93, unchanged —
`git diff 7f3413a53 86d60aab93 --stat` is empty).

## Dependency-rule gate (BL-259, hard gate)
`node extension/out/tools/dependency-gate.js` against the parcel's changed
JS file (`specs/pipeline/steps/bl685StrandedResidentDetectionSteps.js`,
`specs/pipeline/steps/index.js`) reports the same 3 pre-existing
`telegram-front-desk-bot`/`telegramCursorOperatorExec`/
`telegramCursorOperatorLiveness` acyclic violations seen on every recent
pass. Confirmed ticketed: BL-759. Not a BL-685 defect. The step handler's
own imports are `node:assert/strict`, `node:fs`, `node:os`, `node:path`,
`node:child_process`, `node:test`, and the shared `./lib/fixtureReaper` —
no `vscode`, no unusual coupling.

## Co-change report (informational)
All reported couplings are the expected babysitter-family files
(`babysitter_check.bb`, `babysitterd_sweep_lib.bb`, their test runners,
sibling `bl6xx*Steps.js` babysitter step handlers). Nothing surprising, no
suspected coupling outside this subsystem.

## Required wiring (both entries)
1. `check-resident-stranded` is defined in `babysitterd_sweep_lib.bb` and
   called from `assemble-findings`, its result folded into the returned
   `findings` vector — confirmed by reading the diff and by the unit
   test's own required_wiring row (constructs a snapshot with
   `:rotate-note nil` and asserts `"resident-stranded-specifier"` appears
   in `assemble-findings`'s output, with no `rotate-unhonored` co-finding).
2. `babysitter_check.bb` populates `:resident-active-role` as a TOP-LEVEL
   snapshot key straight off the marker file, never through
   `gather-rotate-note` (whose map is nil in exactly the Class B case the
   ticket describes) — confirmed by reading the diff at the
   `assemble-findings` call site.

## Invariant (declared, BL-654)
"Detection never depends on the stranded resident having done anything —
every signal is observable from outside its own turn." Two-part
verification, split appropriately by what each half actually is:
- The check's truth table (fire shape + all suppressors) is encoded
  executably in `bl685_resident_stranded_property_runner.bb` against an
  independently-stated oracle — reran it live: `2000 runs, 14 fire shapes
  reached`, non-vacuous by construction (reachability asserted, not
  assumed).
- The "which inputs are read" half is a structural claim about the
  gatherer's own code, not something a generated-input property test can
  observe — verified by inspection (both gather helpers in
  `babysitter_check.bb` read only the marker file, its mtime, and mailbox/
  coordinator-inbox file contents; nothing depends on resident output) and
  cross-checked against `required_wiring` entry 2 above, which specifically
  guards against the one input that WOULD have quietly violated it
  (reading role off `:rotate-note`, which needs the resident to have
  written a rotate note it never wrote in the Class B case).

## Unit/property/acceptance runs (all reproduced live)
- `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb`: ok.
- `bb swarmforge/scripts/test/bl685_resident_stranded_property_runner.bb`:
  ok (2000 runs, 14 fire shapes reached).
- `node specs/pipeline/cli.js` via
  `./specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-685-stranded-resident-detection.feature`: 9/9 scenarios
  pass (scenario 02's outline covers all 5 non-stranded rows).
- Existing suite regression check: `swarmforge/scripts/test/test_babysitter_check.sh`
  still 9/9 PASS — the shared gather function's new keys don't disturb the
  existing checks.

## Scope check (qa_e2e_procedure step 8)
`git show --stat 7f3413a53`: `babysitterd_sweep_lib.bb`,
`babysitter_check.bb`, the new step handler, the sweep lib's test runner,
and the new property runner. No `check-rotate-not-honored` touched — the
two checks stay additive, matching `out_of_scope`.

## Out-of-scope check
No `send-keys`/`tmux` write/rotate invocation anywhere in the diff — the
check reports and nudges only, matching scenario 05 and the ticket's
read-only constraint.

## Verdict
COMPLIANT. Forwarding to hardender.
