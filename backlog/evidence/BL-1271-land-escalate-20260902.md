# BL-1271 land LAND_ESCALATE — 2026-09-02 (post re-fix)

## Verification result
BL-1271's re-fix (restoring the two assertion names D1 named — see
`backlog/evidence/BL-1271-qa-bounce-20260902.md`) fully PASSES QA:
- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` — ALL PASS,
  78 assertions (77 + the restored duplicate).
- Both original assertion names
  (`"top-expedited-paused-candidate-08 (BL-900): ..."` and
  `"top-expedited-paused-candidate: priority breaks ties among multiple
  expedited candidates"`) are present verbatim again — invariant 2 satisfied.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1271-dispatch-gap-suite-stale-bug-fixtures.feature`)
  — 3/3 pass.
- `required_wiring` both entries confirmed: step handler registered
  (`specs/pipeline/steps/index.js:409`), `top-expedited-paused-candidate-09
  (BL-1271)` present in the suite.

**Approved commit**: `0ea1c8cb3b8effa30f22213b00596bbaa7a8de01`
(QA merge of documenter `5fb0510c3b`).

## Why it cannot land (BL-1241) — same structural cause as BL-1338/BL-1056

`bb swarmforge/scripts/land_step_cli.bb
BL-1271-dispatch-gap-suite-stale-bug-fixtures 0ea1c8cb3b` returns
`LAND_ESCALATE` with entangled unlanded siblings: BL-1040, BL-1056, BL-1283,
BL-1317, BL-1319, BL-1321, BL-1326, BL-1327, BL-1330, BL-1334, BL-1338 — the
same set already escalated in `backlog/evidence/BL-1338-land-escalate-
20260902.md` and `backlog/evidence/BL-1056-a-land-escalate-20260902.md`.

No new adjudication requested beyond what is already pending with the
specifier; this file names BL-1271 in the entangled set for tracking. Not
landing `0ea1c8cb3b`; not moving BL-1271 to done.
