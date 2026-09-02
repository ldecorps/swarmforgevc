# BL-1311 — hardener pass

Commit reviewed: e56c91b11b (architect pass, merged into this worktree) · 2026-09-02

## Scope

Diff is a 4-line resolver swap plus one 3-line wrapper in
`extension/src/bridge/bridgeServer.ts` (compiled: `out/bridge/bridgeServer.js`
lines 152-155, and single-line call-site changes at 165 and 217). No new
CLI subcommand, no `Scenario Outline:` in the ticket's pointed-at feature
file for the touched scenario (BL-709 bubble-topic-07 is a plain
`Scenario:`), so BL-113 Gherkin mutation does not apply here.

## Mutation (Stryker)

Whole-suite `vitest run` carries 15 pre-existing unrelated failing files (the
same set coder/cleaner/architect already documented — none touch
`bridgeServer.ts`/`bubbleMirrorTopic.ts`/any Let's Talk/Bubble path), which
blocks Stryker's dry run outright. Worked around per the "unrelated standing
reds" fallback: scoped `--testFiles` to the two test files that actually
cover this code (`test/letsTalkBridge.test.js`,
`test/bl744TopicMergeHelpers.test.js`, confirmed by grepping every test file
that references `mirrorLetsTalk*`/`choicePollMirrorTarget`/
`effectiveLetsTalkMirrorTopicId`).

First attempt mutated the whole file (`--mutate out/bridge/bridgeServer.js`)
with the testFiles scope, which produced 39+ false `NoCoverage`/`Survived`
mutants across functions the two scoped test files don't own (real coverage
for those lives in test files excluded by the scope) — a measurement
artifact, not a gap; killed and reran range-scoped per the "one file at a
time" / differential-mutation discipline.

Second attempt used `--mutate 'out/bridge/bridgeServer.js:145-230'` (the
whole Let's Talk mirror region, for context) with the same testFiles scope,
`--force`, concurrency 4:

```
bridgeServer.js: 67.46% (85 killed / 38 survived / 3 no cov)
```

**Filtered to the ticket's own diff lines only** (152-155 new
`letsTalkMirrorTopicForPath`; 165 and 217, the two call-site resolver
swaps) — **zero survivors, zero no-coverage** at any of those lines. All 38
survivors in the 145-230 report sit in code this ticket did not touch:
`effectiveLetsTalkMirrorTopicId`'s pre-existing ternary (line 150, BL-709),
`formatBubbleMirrorText` (156-163, pre-existing), `extractLetsTalkChoicePoll`'s
regex/option-parsing (175-197, pre-existing), and the pre-existing
`topicId === undefined` / `!ok` / `!text.trim()` early-return guards in
`choicePollMirrorTarget`/`mirrorLetsTalkTurnToBubble` (166, 218, 222, 226 —
same guard shape, same code, unchanged by this diff; only the value now
*flowing into* `topicId` changed, and that flow is itself fully killed at
165/217).

Per Hardening Order scope ("run the mutation tool on the changed and new
source"), these pre-existing survivors are out of this ticket's scope —
same posture as the cleaner's advisory-only 1823-mutation-site note and the
architect's dead-`bubbleMirrorTopicForPath`-wrapper observation. Not
chased, not ticketed (BL-234/BL-927 territory would apply to any of these
individually, but they predate this diff and this ticket's mutation_cost is
`low`).

## CRAP

`node scripts/crapReport.js src/bridge/bridgeServer.ts`, filtered to the
touched functions:

| function | complexity | coverage | CRAP |
|---|---|---|---|
| `letsTalkMirrorTopicForPath` (new) | 1 | 100% | 1.00 |
| `choicePollMirrorTarget` | 3 | 85% | 3.03 |
| `mirrorLetsTalkTurnToBubble` | 5 | 89% | 5.03 |
| `mirrorLetsTalkChoicePollToBubble` | 5 | 93% | 5.01 |

All ≤6, matching cleaner/architect's prior CRAP-gate runs
(`specs/features/BL-744…feature`, 3/3). File-wide `crapReport.js` flags 33
pre-existing functions elsewhere in this 2323-line file — unrelated to this
diff, not touched.

## DRY

`npx jscpd src/bridge/bridgeServer.ts`: same 2 pre-existing clones cleaner
already reported (726-741/823-838, 1147-1154/1261-1268), nowhere near the
changed lines (118-230). No new duplication.

## Verification re-run

| check | result |
|---|---|
| `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-709-bubble-its-own-telegram-topic.feature` | 8/8 |
| `npx vitest run test/letsTalkBridge.test.js test/bl744TopicMergeHelpers.test.js` | 56/56 |
| `npx vitest run --config vitest.properties.config.mjs test/bl709BubbleOwnTelegramTopic.property.test.js` | 3/3 |

## Handoff

No code changes made — the ticket's own new/changed source is already
fully mutation-killed, CRAP-clean, and DRY-clean from the coder/cleaner
passes. Forwarding the received commit (e56c91b11b) unchanged to documenter.

Leftover process check: `pgrep -fl 'node --test|stryker'` clean before and
after; the detached Stryker run's process group was reaped (confirmed via
`ps -o pgid=`) before starting the range-scoped rerun. No orphaned fixture
files (`git status --short` clean).

By hardener.
