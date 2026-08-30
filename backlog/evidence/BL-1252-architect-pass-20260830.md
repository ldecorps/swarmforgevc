# BL-1252 — architect pass, 2026-08-30

Reviewed the cleaner-forwarded commit `41d7054ddf` (coder `76dd67b69`,
cleaner merge with no additional cleanup).

## Verdict: COMPLIANT — forwarded to hardender

## Correctness read

Read `swarmforge/git-hooks/pre-commit` and `swarmforge/scripts/run_commit_guards.sh`
directly. The hook is now a one-line `exec` delegate; the runner uses
`set -uo pipefail` (deliberately no `-e`) with `guard || st=$?` per call,
matching the BL-1242 precedent the ticket names. Traced the control flow by
hand:

- Tier 1 (`check_commit_size.sh 50`, `check_ticket_deletion.sh`,
  `check_pipeline_code_on_main.sh`) always runs all three regardless of
  earlier results — `run_guard` never short-circuits.
- `status`/`refused`/`unexpected` accumulate correctly across calls; `refused`
  is guaranteed empty on entry to Tier 2 (reachable only via the `if [ -n
  "$refused" ]` early-exit not having fired), so `report_refusals` never
  mixes stale Tier 1 state into a Tier 2-only report.
- Args are passed through unchanged from the original hook: `50` to
  `check_commit_size.sh`, no args to `check_ticket_deletion.sh` (preserving
  BL-901's pre-commit-time defer behavior — the message file genuinely
  doesn't exist yet at this hook stage, unrelated to this ticket).
- A non-1 exit status is distinguished (`unexpected`) but still refuses via
  the same `status`/`refused` accumulation — invariant 3 holds by
  construction, not just by the tests asserting it.

## Constraints verified against the diff, not assumed

- `git diff` of the four guard scripts between the parent and this commit —
  empty. No predicate, threshold, or exemption touched.
- Guard order in `run_commit_guards.sh` matches the original hook's order
  exactly (size → ticket-deletion → pipeline-code-on-main → property-suite).
- `SWARMFORGE_COMMIT_GUARD_DIR` greped across the tree — referenced only by
  this ticket's own shell test and acceptance fixture, never a production
  bypass or `*_FORCE_RESULT`-shaped escape hatch.
- commit-msg hook untouched (not part of this diff at all).

## Independent re-runs

- `bash swarmforge/scripts/test/test_run_commit_guards.sh` → 10/10 PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1252's feature → 9/9.
- `cd extension && npm run compile` then `npx vitest run --config
  vitest.properties.config.mjs test/bl1252CommitGuardAggregationInvariants.property.test.js`
  → 5/5 pass (compiled first this time, after the BL-1210 stale-`out/`
  lesson from earlier this shift).
- `bb swarmforge/scripts/test/suite_inventory_cli.bb` → clean, new shell
  test registered.

## Dependency-rule gate (BL-259, hard gate)

Full-repo scan: `cd extension && node out/tools/dependency-gate.js` →
`Dependency-rule gate PASSED: no forbidden edges.`

## Co-change tool (BL-255)

All flagged co-changes are the hook's own pre-existing history (the four
guard scripts, the sibling `pre-merge-commit`/`commit-msg` hooks, deploy
scripts that reference the hook chain) — expected coupling for a git-hooks
orchestration file, nothing new or unexpected from this parcel.

## Required wiring

- `swarmforge/git-hooks/pre-commit::run_commit_guards.sh` — confirmed: the
  hook's only remaining guard-related line is the `exec` of the runner.
- `specs/pipeline/steps/index.js::bl1252CommitGuardCompleteInventorySteps` —
  registered (`index.js:651`), exercised by the 9/9 acceptance run above.
