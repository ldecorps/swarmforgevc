# BL-1650 coder evidence (QA rework bounce, regression fix)

## What was wrong

QA's rework bounce (`backlog/evidence/BL-1650-bounce-20260920-2.md`) found
that my D1 fix commit (`12c8050b5d`) reverted the cleaner's own earlier
fixture fix: `specs/pipeline/steps/bl1546ClosedOwnerNeverSilentlyExcludesSteps.js`'s
`SHARED_PATH` constant was back to `'docs/shared.md'` instead of the
cleaner's `'swarmforge/scripts/shared.sh'` (commit `332efb5ee6`, "BL-1650:
fix BL-1546's own fixture regression - use a non-doc/evidence shared
path"). A shared path under `docs/` collides with BL-1650's own new
pure-evidence/docs carve-out, so BL-1546's scenario 2 (a closed-owner path
OUTSIDE that carve-out must still refuse/escalate) started passing through
`LAND_REPLAY` instead - the exact regression the cleaner had already
closed in the original pass.

**Root cause** (per QA's own diagnosis, confirmed): my D1 rework was built
on `swarmforge-coder@2` - a different seat/branch than the `swarmforge-coder`
branch that built and cleaned the original BL-1650 pass - and my branch's
ancestry never included the cleaner's `332efb5ee6` fixture fix. Same shape
as the `coder2-stage-queue-dir-mismatch-root-cause-0917` watch entry and
the BL-1652 duplicate-seat incident earlier this same shift.

## The fix

Restored `SHARED_PATH = 'swarmforge/scripts/shared.sh'` in
`bl1546ClosedOwnerNeverSilentlyExcludesSteps.js` (QA's own exact
remediation pointer). No other files use this fixture-path literal in a
way that trips the same collision - `bl1544AmbiguousSubjectNeverSilentlyExcludesSteps.js`
also references `docs/shared.md` but its own feature is independently
green (4/4) both before and after this fix, so it is untouched.

## Tests

- BL-1546's own acceptance feature: 4/4 green (was 3/4 red before this
  fix - "not ok 2", matching QA's own reproduction exactly).
- BL-1650's own acceptance feature: 5/5 green, unaffected (this fix
  touches only BL-1546's own fixture file, never BL-1650's production
  code or its own feature/step handler).
- BL-1544's own acceptance feature: 4/4 green, confirmed unaffected
  (checked because it shares the same `docs/shared.md` literal - it does
  not hit the same collision, left untouched).
- `land_step_lib_test_runner.bb`: ALL PASS.
- Full unit lane (`npm test`): 635 files, green.
- `check_test_file_registration.sh` / `check_feature_handler_registration.sh`:
  clean (no new files).

By coder.
