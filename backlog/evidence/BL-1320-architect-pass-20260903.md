# BL-1320 — architect pass, 2026-09-03

Reviewed cleaner commit `e448f6ecc1` (fixture-leak hygiene fix, BL-971
class), forwarding coder's `dade75b8a8` (the operator how-to, built to
human ruling: docs now, optimizer-emits-recommendation minted as a
separate child).

## Checks run (not assumed)
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1320-operator-step-for-adding-a-seat-to-a-bottleneck-stage.feature`
  — 4/4 scenarios pass.
- Spot-checked the doc's quoted refusal text against the live source:
  `grep -n "declares additional seat" swarmforge/scripts/swarmforge.sh` —
  matches the how-to's quoted text verbatim (`swarmforge.sh:934`).
- Property test (`bl1320DocumentedStepsAreExecutedInvariants.property.test.js`,
  BL-654): `numRuns` set to `2×` each finite enumeration's own size
  (window lines, commands) via `fc.constantFrom` — near-certain coverage by
  construction, not a probabilistic reach risk. Ran 5 consecutive times —
  5/5 clean.
- `node extension/out/tools/dependency-gate.js` on the property test —
  PASSED, no forbidden edges.
- required_wiring: `bl1320SeatOperatorStepSteps` confirmed registered at
  `specs/pipeline/steps/index.js:23`.
- `docs/index.md` correctly has no entry yet for the new how-to page —
  that registration is the documenter's job (Article 1.7), and this
  ticket has not reached that stage.

## Cleaner's fix, verified
Wrapped scenario 01's and 02's terminal steps in try/finally so a fixture
root is never leaked on either the happy path (01 previously never deleted
at all) or a failing assertion (02 previously deleted only past the
assertion) — same BL-971 class hazard already fixed once for BL-1306.
Small, correctly scoped, matches the pattern scenario 04 already used.

## Architecture read
Docs-only chore; no production code touched. The how-to's own scenarios
drive the real `parse_config` and the real `model_steward_cli.bb` rather
than asserting commands in prose — exactly the invariant the ticket
declared, and confirmed non-vacuous (corrupting the seat id and renaming
the steward subcommand both fail the checks, per the coder's evidence,
independently re-verified by running the acceptance and property suites
myself).

## Verdict
Clean sweep. No defect found. Forwarding to hardener.
