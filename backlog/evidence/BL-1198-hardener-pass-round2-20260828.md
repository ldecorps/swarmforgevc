# BL-1198 hardener pass — round 2 (2026-08-28, post-bounce re-fix)

## Reviewed commit

Merged architect's `6775a90b11` (cleaner `0b095c40d`, on coder's bounce
re-fix `c4641ae759` adding the previously-missing acceptance step handler)
clean into hardender, resolving three conflicts: `BL-428.json` (additive,
both messages kept — established pattern this session), `residentPaneSpy.ts`
(architect's own branch predates the BL-1189 specifier-ratified restoration
I applied in my prior merge — kept mine, verified it's the newer,
correctly-landed content), and `specs/pipeline/steps/index.js` (superset of
both sides' requires, deduplicated).

## What changed since round 1

My round-1 hardening pass (`BL-1198-hardener-pass-20260827.md`) covered the
unit/property/wiring-shell verification for `rematch-with-push-first!`
itself but never mentioned acceptance — QA's bounce (`BL-1198-bounce-20260828.md`)
correctly caught that no `bl1198*Steps.js` file existed anywhere in the
delivered work, so the ticket's own declared acceptance feature had zero
step handlers. Coder's re-fix (`c4641ae759`) added:
- `specs/pipeline/steps/lib/bl1198RematchPushFirstCli.bb` — thin driver
  calling the real `rematch-with-push-first!` with real `:push!`/`:reset!`
  git adapters against real (fixture) repos, bypassing the higher-level
  `heal!`/handoffd decision layer (out of scope per the ticket's own text).
- `specs/pipeline/steps/bl1198RematchPushFirstSteps.js` — step handlers,
  two isolated fixture git repos (bare origin + local clone, plus a
  divergent clone for scenario 2) via `mkSocketFixtureRoot`.

## Independent re-verification of my own earlier merge-time fix

While resolving this merge I found the architect's branch independently
hit and fixed the EXACT gap I found and fixed in my own prior merge (BL-1195's
`worktree_drift_lib.bb` load-file silently dropped by a conflict
resolution): `cea6e0212 fix: restore missing worktree_drift_lib.bb
load-file, dropped during merge conflict resolution` and `98f99c728 fix:
restore missing worktree_drift_lib.bb load-file in ready_for_next.bb` are
both in this merge's ancestry. Confirms the class of defect (a conflict
resolution correctly keeping the CALLING code while silently dropping the
CALLED library) is real and was independently caught twice, not a fluke.

## Fixture hygiene review (step handler)

`bl1198RematchPushFirstSteps.js`'s `cleanupFixtureState` is called in a
`finally` at each scenario's own terminal step ("no reset --hard is
performed" for scenario 1, "only after that push is rejected..." for
scenario 2) — matches the established BL-971 pattern. Checked the
Given-step-throws-before-terminal-cleanup class (2026-08-18 rule): the
Background step (`local main holds one or more commits...`) creates two
fixture roots via `mkSocketFixtureRoot` and runs several `git` calls with
no local `try/catch` — if any of those throws, `cleanupFixtureState` is
never reached. Checked the backstop:
`specs/pipeline/steps/lib/socketFixtureRoot.js` installs
`process.on('exit', removeStragglers)` (line 57) as a repo-wide fallback
independent of this file's own cleanup, so a mid-Given throw still cleans
up at process exit. No tmux/git-server processes are started here (plain
file-based git repos only), so this is the disk-only leak class, fully
covered by the exit hook.

## Full verification (re-run)

- `npm run compile` — clean.
- `bb .../master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS.
- `bb .../master_main_reconcile_lib_property_runner.bb` — 500 runs, ALL
  PROPERTIES HOLD, including the ticket's own invariant
  ("reset never fires without push being attempted and failing first")
  with its own printed non-vacuity confirmation.
- `bash .../test_swarm_heal_push_before_reset.sh` — ALL PASS (4
  assertions: ahead-only commit left untouched by `heal!`, stays
  unpushed, genuine-divergence reset recovery still lands on origin's
  real tip, genuinely-diverging local-only commit still discarded as
  designed).
- `node specs/pipeline/cli.js specs/features/BL-1198-...feature` — 2/2
  scenarios pass against the real fixtures and real git adapters (no
  Scenario Outline — BL-113 Gherkin mutation not applicable).
- `test/residentPaneLive.test.js` / `test/residentPaneSpy.test.js` — 43
  tests green (touched only by the merge-conflict resolution, not by
  this ticket's own diff; re-run to confirm my manual conflict
  resolution didn't regress them).
- No `extension/src/*` production files touched by THIS ticket's own
  diff (only via the unrelated merge conflict) — CRAP/DRY tooling not
  applicable, matching the architect's own disposition. Babashka has no
  wired mutation/CRAP/DRY tooling (engineering.prompt) — the unit +
  property + real-git wiring shell test are the full applicable
  verification surface for the `.bb` side, all re-run directly above.

## Disposition

Hardened. Re-fix is correctly scoped, fixture-hygienic (with a confirmed
backstop), and fully covered by unit/property/acceptance/wiring tests, all
re-run green. No new defect found. Forwarding to documenter.

By hardender.
