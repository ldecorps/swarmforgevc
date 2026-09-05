# BL-1312 — hardener pass, 2026-09-05

Ticket: BL-1312-fixture-root-cleanup-does-not-survive-sigterm
Commit reviewed: 6d0f6ad2c3 (architect NONE pass)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `node specs/pipeline/cli.js specs/features/BL-1312-fixture-root-signal-cleanup.feature` | 4/4 pass |
| `node specs/pipeline/cli.js specs/features/BL-324-per-role-lifecycle-park-unneeded-roles.feature` (regression, edited caller file) | 11/11 pass |
| `node specs/pipeline/cli.js specs/features/BL-1305-fixture-agent-binary-is-the-stub.feature` (regression, other named offender) | 3/3 pass |
| `npx vitest run test/socketFixtureShortRootGuard.test.js test/bl948SocketGuardLimitParity.test.js test/tmuxReaperGuard.test.js` | 34/34 pass |
| `npx vitest run --config vitest.properties.config.mjs test/bl948SocketFixtureInvariants.property.test.js test/fixtureReaperLiveSocketGuard.property.test.js test/bl1032TmuxReaperScope.property.test.js test/bl789MacHostSwitchFreshnessBridgeAdoptInvariants.property.test.js` | 11/11 pass |
| `npm run compile` | clean |
| `grep -c onAbnormalExit specs/pipeline/steps/lib/socketFixtureRoot.js` | 4 |
| `grep -n "process.on('SIGTERM'\|process.on('SIGINT'" specs/pipeline/steps/lib/socketFixtureRoot.js` | none — confirms no private signal listener was added |
| `backlog/standing-reds.tsv` / `property_suite_standing_allowlist.tsv` | neither names this file family |
| leftover process/fixture check (`pgrep`, `git status --short`, `ls -d /tmp/aps-* /tmp/bl*`) | 0 leaked roots, clean |

## Independently read the fix and its primitive (not just trusted)

Read `specs/pipeline/steps/lib/socketFixtureRoot.js` directly:
`installExitHook` now calls `onAbnormalExit(removeStragglers)` instead of
a bare `process.on('exit', ...)`. Read `fixtureReaper.js`'s
`installGlobalHandlersOnce` (gated by module-level `globalHandlersInstalled`
flag) and `onAbnormalExit` (calls `installGlobalHandlersOnce()` then
pushes onto `abnormalExitCallbacks`) directly — confirms invariant 1 (the
same `exit`/SIGINT/SIGTERM coverage `track()`/`reap()` already have) and
invariant 2 (one listener set regardless of caller count, by
construction) both hold, matching every prior role's claim exactly.

## Independently re-confirmed non-vacuity myself (not just trusted)

Backed up `socketFixtureRoot.js`, reverted `installExitHook` to the
pre-fix bare `process.on('exit', removeStragglers)` form, re-ran the
acceptance feature: **1 pass / 3 fail** — both "not installed" Outline
rows and the listener-count scenario failed, exactly matching the
coder's and architect's own claimed non-vacuity result. Restored the
file; confirmed byte-identical via `diff` and `git status --short`
(empty).

## Independently confirmed the jscpd clone is out of this ticket's own diff

`npx jscpd` on the touched `.js` files under `specs/pipeline/steps/`
returns "0 files analyzed" (the same `.jscpd.json` `pattern: "**/*.ts"`
limitation noted in this session's BL-1229/BL-1206/BL-1287 evidence).
Rather than re-trust the cleaner's/architect's own jscpd run, diffed
`roleLifecycleParkUnneededSteps.js` directly against its true parent
(`b99eaac73b^..b99eaac73b`): this ticket's ENTIRE diff to that file is a
6-line comment plus moving one existing statement
(`liveFakeBinDirs.add(dir)`) six lines earlier inside `mkFakeBin` —
nowhere near the clone's reported location (lines 246-261). This
independently rules out the clone being introduced or altered by this
ticket's own diff, without needing jscpd to run.

## BL-113 hard gherkin mutation: clean

One `Scenario Outline` (scenario 01, 3 examples × 2 mutable columns = 6
mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals
explicit, workdir removed after). Result: **6 mutants, 6 killed, 0
survived** — manifest confirms
`"Total":6,"Killed":6,"Survived":0,"Errors":0"`. Scenario 02 is a plain
`Scenario:`, not a mutation target.

## Design/CRAP/DRY

No production `extension/src` code changed (acceptance-runner-side
shared helper + one caller-side fix, per the ticket's own scope).
Mutation-site-count tooling does not apply (plain JS under
`specs/pipeline/steps/`, not Stryker's `out/**/*.js` scope — re-confirmed
independently, matching the cleaner's own judgment).

## Verdict

No defect. Forwarding to documenter.
