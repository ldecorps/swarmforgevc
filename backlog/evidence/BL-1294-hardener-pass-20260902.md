# BL-1294 — hardener pass — 20260902

**Merged:** architect `196837b89e` into hardender.

## Verdict: PASS — forward to documenter.

## Scope of this pass

Parcel touches only test infrastructure — no `extension/src/**` file changed
(`git diff --stat 66a3e2abcf..HEAD -- extension/src` empty). Both the CRAP
gate (`npm run crap`, scoped to `src/*.ts`) and the DRY gate (`npm run dry`,
scoped to `src`) are therefore not applicable to this parcel — nothing they
measure changed.

## Mutation coverage

`extension/test/helpers/pinnedRepoFixture.js` is not compiled to `out/`, so
it sits outside Stryker's `mutate: ["out/**/*.js"]` scope — the general
no-tooling-configured fallback applies. Hand-authored a 3-mutant sweep over
the parcel's actual diff (`copyScriptClosure`'s `continue`→`throw` change,
the only functional change in this file — confirmed by diff against base
`66a3e2abcf`; the path-preservation half of the ticket was already fixed by
BL-1240 before this parcel started, per the architect's prior pass):

| mutant | change | result |
|---|---|---|
| M1 | revert dependency-miss back to `continue` (the original BL-1294 bug) | KILLED — `pinnedRepoFixture.test.js` |
| M2 | swap the `entry point`/`dependency` label ternary | KILLED |
| M3 | drop `${name}` from the thrown error message | KILLED |

All three applied to the live file, run against `test/pinnedRepoFixture.test.js`,
confirmed red, then reverted (`diff` against a pre-mutation copy confirmed
byte-identical restore). Feature file's `Scenario Outline` (scenario 01) has
no separate BL-113 gherkin-mutation need beyond this — its step handlers
route through `copyScriptClosure` and were exercised at the unit level above;
the acceptance scenario itself has no `Scenario Outline` on a discriminating
Examples column, its example values are copied verbatim into path/dependency
strings the sweep above already covers.

## Verification re-run (all green)

| check | result |
|---|---|
| `extension/test/pinnedRepoFixture.test.js` | 16/16 |
| `extension/test/telegramFrontDeskBotCli.test.js` | 271/271 |
| `extension/test/telegramFrontDeskBotCli.property.test.js` (properties lane) | 3/3 |
| `extension/test/bl1294FixtureClosurePathAndFailureInvariants.property.test.js` (properties lane) | 2/2 |
| `specs/pipeline/cli.js` on the BL-1294 feature | 4/4 |
| `ls /tmp \| grep -c bl1294` before/after acceptance run | unchanged (no leak, matches architect's prior confirmation) |

## Handoff

`git_handoff` to documenter, priority `00`, task
`BL-1294-fixture-script-closure-preserves-dependency-paths`.

By hardender.
