# BL-1303 architect repass — 2026-08-31

Reviewed cleaner's forward `4e3172dc96` ("cleaner pass — no defect found, DRY
concern already closed by coder"), merged into `swarmforge-architect` as
`8c83d7faf2`. This is the rework of my own prior bounce `fbcc7b7712`
("pre-merge-commit still doesn't reach the guard" — `required_wiring` anchor 2
was unmet).

Parcel scope (diff `60659c9367...4e3172dc96`, 12 files):
`swarmforge/git-hooks/pre-merge-commit`,
`swarmforge/scripts/run_commit_guards.sh`,
`swarmforge/scripts/commit_guard_chain_lib.sh` (new),
`swarmforge/scripts/check_feature_handler_registration.sh` (header only),
`specs/pipeline/steps/bl632CommitTimeGuardSteps.js`,
`extension/test/bl632CommitTimeGuardInvariants.property.test.js`,
`swarmforge/scripts/test/test_pre_merge_commit_hook.sh` (new),
`swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh`,
`swarmforge/scripts/test/test_run_commit_guards.sh`,
`swarmforge/scripts/test/suite-manifest.tsv`,
plus two new evidence files.

## Architecture / boundary checks

- Two-layer boundary, extension-host I/O ownership, no webview storage,
  secrets-in-env: N/A — this parcel touches only git hooks and bash test
  scripts, no extension-host/webview code.
- `node extension/out/tools/dependency-gate.js` (full-repo scan, no args):
  **PASSED, no forbidden edges.**
- `node extension/out/tools/co-change-report.js` against all 10 non-evidence
  changed files: every co-change hit is frequency 1, below the default
  threshold of 3 — no suspected coupling flagged.
- DRY: coder's `commit_guard_chain_lib.sh` extraction (this was the D2 item
  the specifier flagged for cleaner/architect to weigh) is the correct fix —
  `run_guard`/`report_refusals` now live once, sourced by both
  `run_commit_guards.sh` and `pre-merge-commit`, both under `set -uo pipefail`
  with no `-e`. Confirmed no remaining duplication.

## required_wiring anchors (all 3 present)

1. `run_commit_guards.sh::run_guard check_feature_handler_registration.sh` —
   present (`swarmforge/scripts/run_commit_guards.sh:67`).
2. `pre-merge-commit::check_feature_handler_registration.sh` — present
   (`swarmforge/git-hooks/pre-merge-commit:55`, via `run_guard`), closing the
   gap my prior bounce named. `pre-merge-commit` is NOT repointed at
   `run_commit_guards.sh` wholesale (verified: no invocation of it in the
   hook, only prose referencing why not).
3. `specs/pipeline/steps/index.js::bl1303` — present (`index.js:910`,
   `bl1303FeatureHandlerRegistrationSteps`).

## Invariants review

Both declared invariants ("fails closed on an unresolvable/unreadable
artifact" and "one pass reports every offender") are encoded, non-vacuously,
in `test_pre_merge_commit_hook.sh` cases 03/04 (completeness — both guards
run and are named even when the first refuses) and 06/09 (fail-closed — a
missing guard script, and a missing `commit_guard_chain_lib.sh`, both refuse
rather than falling through to `exit 0`). These are real break-then-restore
checks (`rm -f`/fixture mutation), not assertions against a mock.

## Tests run (all green)

- `bash swarmforge/scripts/test/test_pre_merge_commit_hook.sh`: 9/9 PASS.
- `bash swarmforge/scripts/test/test_run_commit_guards.sh`: 12/12 PASS.
- `bash swarmforge/scripts/test/test_check_feature_handler_registration.sh`: 7/7 PASS.
- `node specs/pipeline/cli.js specs/features/BL-1303-...feature`: 7/7 PASS.
- `npx vitest run --config vitest.properties.config.mjs bl632CommitTimeGuardInvariants`
  (from `extension/`): 1/1 PASS.
- `bash swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh`: all
  cases PASS except the pre-existing, out-of-scope "BL-925 invariant 2:
  handoffd.bb still runs its own inline ancestry git call" —
  `swarmforge/scripts/handoffd.bb` is byte-identical to `main` and untouched
  by this parcel; already surfaced by coder to the specifier (commit
  `652603514d`) and recorded in cleaner's own pass evidence. Not re-reported.

## Verdict

CLEAN — no violation. Forwarding `8c83d7faf2` to hardener.
