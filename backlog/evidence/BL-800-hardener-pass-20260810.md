# BL-800 hardener pass — 2026-08-10

Reviewed the commit received via architect's `merge_and_process architect
2d1504fb2f` (clean pass, NONE — `backlog/evidence/BL-800-architect-pass-
20260810.md`), coder-authored `a53e6f3754`, forwarded unmodified by cleaner.
Scope: `specs/pipeline/steps/bl623RoutingSkipTrailSteps.js` (`registry.define`
-> `registry.defineScoped(..., FEATURE_NAME)` for the "the parcel is
delivered to QA" step, plus the new `FEATURE_NAME` constant) and
`extension/test/bl800StepRegistryScopingConsistency.property.test.js` (new,
architect-owned property test).

## BL-149 cooldown gate

`bb swarmforge/scripts/mutation_cooldown_gate.bb . specs/pipeline/steps/
bl623RoutingSkipTrailSteps.js` -> `run` (file age 6.09d > 3d cooldown, host
quiet at gate time, load_avg 5.11 on 4 cores).

## Tooling scope for the changed production file

`specs/pipeline/steps/*.js` is outside every wired quality tool's scope:
Stryker mutates `out/**/*.js` (compiled `extension/src`, per
`stryker.config.json`) and `npm run dry` scopes jscpd to `src` under
`.jscpd.json`'s `**/*.ts` pattern only. No `src/*.ts` file is touched by this
parcel, so CRAP is also N/A (nothing for `crapReport.js` to look up). This
mirrors the documented Babashka/Kotlin gap: gated by its own suite, not by
mutation/CRAP/DRY.

## BL-113 Gherkin acceptance mutation

`specs/pipeline/scripts/run_gherkin_mutation.sh specs/features/BL-623-
routing-skip-trail-records-actual-hop.feature ./tmp/bl800-gherkin-check
specs/pipeline/steps/bl623Only.js soft` -> `outcome: "inapplicable"` (the
feature has 7 plain `Scenario:` blocks, no `Scenario Outline:`/`Examples:` to
mutate). Per BL-638 this is not read as a pass; manifest stamp
(`# acceptance-mutation-manifest-*`) written to the feature file is the
tool's own inapplicable record, not a skipped hardening step.

## Hand-authored mutation sweep (BL-638 fallback, no wired tool reaches this file)

Two single-edit mutants against the fix's own mechanism, each applied,
tested against `bl800StepRegistryScopingConsistency.property.test.js`, then
reverted (confirmed via `git diff` back to empty before moving on):

1. **Drop the scoping fix**: `registry.defineScoped(pattern, handler,
   FEATURE_NAME)` -> `registry.define(pattern, handler)` (reproduces the
   pre-fix shape — BL-606's earlier unscoped generic pattern wins again).
   KILLED: the main property test failed with a handler-source mismatch
   (`fromFull` resolved to bl606's `ctx.bounceHandoff` handler,
   `fromFocused` to bl623's own handler).
2. **Mismatch `FEATURE_NAME`**: `'The routing skip trail records...'` ->
   `'The Routing skip trail records...'` (casing typo). KILLED: both tests
   failed — the scoped-registration pass in `stepRegistry.js`'s `resolve()`
   no longer matches `feature.name`, so even the FOCUSED registry falls
   through to its unscoped-only pass and finds nothing (`bl623Only.js` has
   no other registration for that step) — `fromFocused` came back `null`,
   caught by the fixture-assumption assertions in both the main property
   test and its non-vacuity companion.

Both mutants killed by the parcel's own test; no test gap found in this
untooled area.

## Tests run (independent re-verification, not just the ticket's/architect's claim)

- `npx vitest run --config vitest.properties.config.mjs test/
  bl800StepRegistryScopingConsistency.property.test.js` — 2/2 pass
  (re-confirmed on the restored original file after the mutation sweep).
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-623-routing-
  skip-trail-records-actual-hop.feature` (default full-registry entry
  point) — 7/7 pass.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-606-
  specifier-declared-required-stages-routing.feature` — 18/18 pass (the
  ticket's own e2e step 4: the fix must not steal BL-606's own matches).
- `npm test` (full unit suite via `recordTestDuration.js`): 419/420 files,
  7415/7418 tests passed. The 1 failing file
  (`test/renderBriefingDiagramsCli.test.js`, 3 assertions) is unrelated to
  this ticket (diagram-rendering CLI, no dependency on step registries or
  routing) and was accompanied by 110 unhandled `[vitest-worker]: Timeout
  calling "onTaskUpdate"` errors and a 246s/10s suite-budget overrun in the
  same run. `uptime` immediately after: load averages 23.95/24.21/15.25 on
  4 cores (~6x cores), up from 5.11 before the run — the documented
  worker-timeout-under-severe-load signature. Re-ran the file alone at
  that point: 4/4 pass in 20.2s (vs the 94.0s the budget guard flagged
  inside the contended full run). Confirmed environmental, not a BL-800
  regression; not fixed here (out of scope, no relation to the changed
  code).

## Orphan check

`pgrep -fl 'node --test|stryker'` — none. `pgrep -afl tmux` — only the live
swarm's own `.swarmforge/operator/operator-tmux.sock`; no leaked fixture
sockets from the acceptance runs.

## Verdict

No defects in BL-800 itself; the architect's clean pass holds. Forwarding to
documenter, same task name, commit `a53e6f3754` (per lineage — cleaner and
architect both made no code changes past the coder's original commit).
