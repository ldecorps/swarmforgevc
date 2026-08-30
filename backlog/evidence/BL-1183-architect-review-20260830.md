# BL-1183 — architect design review, 2026-08-30

Reviewed commit `0480a5c33e` (coder) + cleaner's stale-comment fix
(`3bd41968a`), merged into architect at `5ec87db75d`. This file was never
written the first time this parcel passed through — QA correctly bounced
for the missing gate artifact (`backlog/evidence/BL-1183-bounce-20260830.md`,
the same shape as `BL-1224-bounce-20260830.md` earlier this session). The
review itself was done in-session at the time (see the architect turn that
sent this parcel to hardener with commit `5ec87db75d`) but not recorded;
recording it now, unchanged from what was actually checked.

QA's own bounce did a diagnostic tip-pure rebuild (not landed) isolating
BL-1183's six real commits from an unrelated entanglement (a stray
`bl1224WatchAdoptsRestartedRuntimeSteps` require that existed transiently on
the shared coder/cleaner branch while BL-1224 was bounced-and-reverted on my
branch) and confirmed the ticket's own logic clean in isolation. That
entanglement is now moot: BL-1224 is back on this branch (recovered from a
separate criss-cross-merge-base incident earlier this same merge), and both
`bl1183BobGoLiveGateSteps` and `bl1224WatchAdoptsRestartedRuntimeSteps` are
registered side by side with no module error — reverified below.

## Constraints checked against the diff directly, not just the tests

- `expected-live-set`/unrelated files untouched — this ticket touches only
  `model_steward_trial_lib.bb` (new `go-live-*` functions) and
  `model_steward_cli.bb` (the gate call site + `trial go-live` subcommand).
- The gate sits in `run-trial-nominate` BEFORE `nominate` is called — read
  directly, not inferred from the tests: `trial-die!` fires before the
  `nominate` call if the checklist refuses.
- `readiness`/`checklist` is DERIVED from what `decide` (BL-1182) actually
  needs (a role-matrix score for both models, plus
  `battery-or-scorecard-evidence?` — the same predicate
  `ranking-authority-tier` already uses), not a second, hand-invented list
  that could drift from it.
- Fail-closed: `go-live-checklist`'s `:missing` vector is empty only when
  every one of the four facts (candidate scored, candidate assessed,
  permanent scored, permanent assessed) is positively true; an absent
  role-matrix entry, an unreadable registry, or an unscored candidate all
  produce a named gap, never a silent pass.
- `go-live-refusal` returns one string carrying every gap — a caller cannot
  report the verdict without the reasons.
- `trial go-live` (the read-only subcommand) seats nothing and calls
  `nominate` never — confirmed by the hardener's own added test section 06
  ("go-live arms nothing" / "go-live moves no seat" / "go-live runs no
  memory transfer"), re-run below.

## Invariants

1. "Production day-long trials refuse to start when the go-live checklist is
   not satisfied." — the gate precedes `nominate` in `run-trial-nominate`,
   structurally, not by convention.
2. "Checklist failure names the missing telemetry or assessor — never a
   silent skip into live trial." — `go-live-checklist`'s `:missing` list
   names each gap by model AND half (telemetry vs assessor); `trial-die!`
   prints to stderr and exits non-zero, never silent.

Both property-tested (`bl1183_go_live_gate_property_runner.bb`, 400
runs/invariant, non-vacuous coverage across
perm-unscored/perm-unassessed/trial-unscored/trial-unassessed/fully-ready).

## required_wiring — re-verified after the specifier's amendment

Row 1 was originally prose (`"BoB trial start path::..."`) and could never
match — I flagged this as a spec-gap during my original review pass and
routed it to the specifier by note; the specifier has since re-anchored it
(`bf9178c67`) to `swarmforge/scripts/model_steward_trial_lib.bb::go-live`,
confirmed present (`go-live-readiness`/`go-live-checklist`/`go-live-refusal`
all match). Row 2 (`specs/pipeline/steps/index.js::bl1183BobGoLiveGateSteps`)
unchanged and confirmed registered.

## Runs (reproduced during this review, on the current merged tree)

- `cd extension && npx tsc -p .` — clean.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1183-bob-go-live-telemetry-assessor-gate.feature` — 3/3.
- `bb swarmforge/scripts/test/model_steward_trial_lib_test_runner.bb` — ALL
  PASS.
- `bb swarmforge/scripts/test/bl1183_go_live_gate_property_runner.bb` — ALL
  PASS, 400 runs/invariant.
- `bash swarmforge/scripts/test/test_model_steward_trial_cli.sh` — ALL
  CHECKS PASSED, including the hardener's own section 06 (13 checks driving
  the real `trial go-live` CLI).
- BL-1182's own suite unaffected (verified earlier in this session; no
  further changes to that lifecycle since).

## Disposition

No defect found. Design review passed — this file is the record QA's
bounce asked for. Re-forwarding to hardender with the same content this
parcel already carried (no code touched by this pass).
