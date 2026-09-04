# BL-1309 — architect review, 2026-09-04

Reviewed coder commit `aba92d6998` (rebuild to the BL-1375-revised ruling:
narrow the refusal to withheld/pending/unreadable siblings, let approved
ones ride) plus its evidence-only follow-up `44814585e7`.

## Checks run

- Dependency gate (`node extension/out/tools/dependency-gate.js
  specs/pipeline/steps/bl1309LandDecideStepEntanglementSteps.js`, run from
  `extension/`): PASSED, no forbidden edges.
- Co-change report on the same file and `land_main_publish.sh`: all
  suspected-coupling hits are within-domain (BL-1144 land/publish family,
  its own test runner, QA.prompt, master_main_reconcile_lib.bb) — expected,
  not a design smell. No action.
- Re-ran independently rather than trusting the commit message:
  - `land_main_publish_test_runner.sh`: 12/12 PASS (matches claim).
  - `run_acceptance.sh` on the BL-1309 feature: 10/10 PASS (matches claim).
  - `npx vitest run --config vitest.properties.config.mjs
    bl1309LandDecideEntanglementInvariants`: 3/3 PASS (matches claim).
  - `check_feature_handler_registration.sh`: exit 0.

## Architecture

`land_main_publish.sh` now calls `land_step_lib.bb`'s pre-existing
`blocking-siblings` (BL-1375) instead of re-deriving withheld/pending logic
inline — the mandatory decide step and the hand-run `land_step_cli.bb`
share one predicate, which is exactly the "cannot disagree" property the
ticket is chasing. `set -euo pipefail` is respected: the detector call is
captured via `|| true` (Guardrails/BL-1242/BL-1252), never left to abort
the script and strand the land lock.

## Invariants (ticket-declared)

- Invariant 1 (no unlanded content advised) is correctly NARROWED to the
  revised ruling in the property test's own header and behavior, not
  silently reinterpreted. The ticket YAML's `invariants:` text is now stale
  (still says "no unlanded ticket... " unconditionally) — the coder raised
  this as a spec-gap note rather than editing the ticket or hand-verifying
  the old wording. Confirmed correct: not my call to fix, and hand-verifying
  a stale invariant would be worse than flagging it.
- Invariant 2 (fail-open) verified both by the re-run property test and by
  reading the fail-open (`|| true`, warning-is-silence) vs fail-closed
  (unreadable sibling approval still blocks) asymmetry directly in the
  code — matches BL-1375's own invariant 1 ("absence never buys a ride").

## Second spec gap (required_wiring entry 2, stale post-BL-1371)

Confirmed independently: `grep -c bl1309LandDecideStepEntanglementSteps
specs/pipeline/steps/index.js` → 0, because BL-1371 (merged into this
worktree earlier today) replaced the hand-maintained `DOMAINS` array with
file discovery. The anchor's actual purpose (pin the draft→live promotion)
is already satisfied — `specs/features/BL-1309-...feature` is live and
`acceptance:` points at it. Not a defect in this parcel; the coder's note
to the specifier is the correct route, matches Article 4.4's "spec-gap
leaves by note" rule.

## Correctness read

No defect spotted beyond the two already-routed spec gaps. Verdict:
COMPLIANT. Forwarding to hardener.
