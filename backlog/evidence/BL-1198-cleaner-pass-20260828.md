# BL-1198 — cleaner pass — 2026-08-28

**Received:** `merge_and_process coder c4641ae759` (coder's QA-bounce re-fix:
missing acceptance step handler for `master_main_reconcile_lib.bb`'s
`rematch-with-push-first!`).

## What coder delivered

- `specs/pipeline/steps/lib/bl1198RematchPushFirstCli.bb` — a thin babashka
  driver calling the already unit/property-tested `rematch-with-push-first!`
  with real `:push!`/`:reset!` adapters against a real (fixture) git repo.
- `specs/pipeline/steps/bl1198RematchPushFirstSteps.js` — step handlers
  wiring the feature's Background/Given/When/Then to that driver, using two
  isolated fixture git repos (bare origin + local clone, plus a divergent
  clone for scenario 2) via `mkSocketFixtureRoot`/`releaseSocketFixtureRoot`,
  cleaned up in a `finally` on both terminal steps.
- `specs/pipeline/steps/index.js` — registers the new step file.

No production logic — mechanical wiring only, per coder's own commit
message and QA's original bounce evidence.

## Cleanup review

- **Coverage:** both acceptance scenarios exercise the real adapters end to
  end (outcome + call-tracking, not inferred from git state alone).
- **Mutation-site count:** `bl1198RematchPushFirstSteps.js` is 184 sites
  (over the 100 advisory threshold). Left whole — it is a single cohesive
  step-handler file for one feature, matching every other `bl*Steps.js` file
  in this directory (one file per ticket's step vocabulary); splitting it
  would break that convention for no structural gain, not reduce coupling.
- **DRY:** `jscpd` found no duplication against the CLI driver or elsewhere.
- **Isolation:** all git operations are scoped to fixture directories
  (`mkSocketFixtureRoot`), never the real worktree; fixtures are removed via
  `rmSync` in `finally` blocks on both scenario-ending steps.
- **Fixture cleanup:** confirmed `cleanupFixtureState` releases all three
  possible fixture roots (`root`, `remoteRoot`, `divergentCloneRoot`) and is
  called from both scenarios' terminal step, not only the happy path.

No changes made — the delivered fix is small, mechanical, well-isolated,
and already covered. Nothing to refactor that would improve rather than
just churn it.

## Verification

- `npm run compile` — clean.
- `node specs/pipeline/cli.js specs/features/BL-1198-main-rematch-reset-must-attempt-push-before-discarding-local-ahead-commits.feature` — 2/2 pass.
- `node -e "require('./specs/pipeline/steps/index.js')"` — loads without error.

By cleaner.
