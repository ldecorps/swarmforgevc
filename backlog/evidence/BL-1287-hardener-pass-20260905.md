# BL-1287 — hardener pass, 2026-09-05

Ticket: BL-1287-a-fixture-sweep-must-not-signal-a-live-runs-fixtures
Commit reviewed: cd69c49aa7 (architect, redo pass after bounce)

## Result: NONE — no defect found

## Independent re-verification (all re-run in this worktree, all green)

| check | result |
|---|---|
| `npx vitest run test/helpers/fixtureTunnelName.test.js` | 7/7 pass |
| `npx vitest run --config vitest.properties.config.mjs test/bl1287FixtureSweepScopingInvariants.property.test.js test/bl1061TunnelFixtureIsolation.property.test.js` | 8/8 pass |
| `npx vitest run --config vitest.properties.config.mjs test/bl857TunnelOwnershipInvariants.property.test.js test/bl787NamedTunnelInvariants.property.test.js` (concurrent overlap regression) | 7/7 pass |
| `npm run compile` | clean |
| `node out/tools/mutation-site-count.js extension/test/helpers/fixtureTunnelName.js` (path corrected to repo-root-relative — PROJECT_ROOT resolves 3 levels above `extension/out/tools/`, not `extension/`) | 101, one over the 100 advisory threshold — matches cleaner/architect; no-split judgment re-confirmed (one cohesive concern) |
| `npm exec jscpd` on the touched/new files | 0 files analyzed both times (`.jscpd.json`'s `pattern: "**/*.ts"` excludes these `.js` files — the same jscpd invocation-syntax limitation noted in this session's BL-1229/BL-1206 evidence). Substituted with a direct grep for each de-duplicated function name (`spawnFakeCloudflared`, `nameWithCreator`, `deadPid`, `killPid`) across all five touched/new files: each appears exactly once, in the shared `bl1287FixtureSweepFixture.js` — confirms the cleaner's DRY extraction holds, zero duplicate definitions |
| `npx vitest run --config vitest.properties.config.mjs test/bl1280MkdtempMigrationInvariants.property.test.js` (guard, after cleaner's self-caught mkdtemp fix) | 6/6 pass |
| `node specs/pipeline/cli.js specs/features/BL-1287-...feature` | 4/4 pass |
| `backlog/standing-reds.tsv` / `swarmforge/scripts/property_suite_standing_allowlist.tsv` | neither names this file family — correct, this is a genuine fix not a standing-red waiver |
| leftover process/fixture check (`pgrep`, `git status --short`) | clean before and after every run |

## Independently read the fix itself (not just trusted from evidence)

Read `extension/test/helpers/fixtureTunnelName.js:73-152` directly:
`creatingPidFor` extracts the creator pid from the fixture's own
`fixtureTunnelName()`-minted command line; `isProcessAlive` guards
`pid <= 0`/non-integer first, then layers a `ps -o stat=` zombie check
(`stat.startsWith('Z')`) after the pre-existing `kill(pid, 0)` probe —
exactly the bounce's own remedy, matching both the cleaner's and
architect's descriptions byte-for-byte. `leakedFixtureTunnelPids`'s
selection chain: temp-path + cloudflared + `run \S` match (invariant 3,
unchanged) → creator-liveness filter (`creatorPid === null` falls back to
selected, i.e. pre-BL-1287 posture for an unknown-shape line; otherwise
selected only when `!isProcessAlive(creatorPid)`) → self-pid exclusion.
This directly satisfies invariant 1 (a live creator's fixture is filtered
out) and invariant 2 (a zombie creator now correctly reads as not-alive,
so its fixture is still selected).

## BL-113 hard gherkin mutation: clean

One `Scenario Outline` (scenario 01, 2 examples × 2 mutable columns = 4
mutants). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh <feature> <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js hard` (all 4 positionals
explicit, workdir removed after). Result: **4 mutants, 4 killed, 0
survived** — manifest confirms
`"Total":4,"Killed":4,"Survived":0,"Errors":0"`. Scenarios 02 and 03 are
plain `Scenario:` blocks, not mutation targets.

## Design/CRAP/DRY

No production code changed (test-harness-only fix, per the ticket's own
"Out of scope" — no source module touched, confirmed via
`git diff --name-only`). Mutation-site-count on the touched helper is 101
(one over the BL-485 advisory threshold); no-split judgment re-confirmed
independently — one cohesive concern (tunnel-name shape + leak-detection
selection). jscpd substitute (grep) confirms zero duplication.

## Verdict

No defect. Forwarding to documenter.
