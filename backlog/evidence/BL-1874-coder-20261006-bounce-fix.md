# BL-1874 — coder pass, 2026-10-06 (bounce fix)

QA bounce (backlog/evidence/BL-1874-QA-20261006.md, commit d368133925):
D1 (behavior), coder-owned. Fixed.

## D1 — a failed refresh was read as the signal genuinely clearing
`updateThrottleEpisode` treated a null `rawCap` as "the signal cleared"
unconditionally, whether the null came from a genuine clear OR from the
rework half being forced null by a refresh failure (BL-1874's own earlier
fix). On a failed-refresh tick, this stamped `clearedAtIso` and the
change-log reason said "rework diagnosis cleared" — wrongly raising
BL-1982's human-release question on a diagnosis that never actually
cleared.

- `updateThrottleEpisode` gains a `reworkRefreshFailure: boolean = false`
  argument (threaded from `emitThrottleRecommendation` as
  `recommendation.refreshFailureReason !== null`). Both branches that
  previously read a null `rawCap` as a withdrawal — the released-episode
  close and the `clearedAtIso` stamp — now also require
  `!reworkRefreshFailure`. The default keeps every existing caller/test
  (all pre-BL-1874) byte-identical.
- `describeChangeReason` checks `rec.refreshFailureReason` before falling
  into the "cleared" wording: it now names the failure directly
  (`refresh failed, rework signal unknown this tick (<reason>)`, or
  `held at <N> - refresh failed, not a clear (<reason>)` when an
  unanswered episode is open), never "rework diagnosis cleared".

## Non-vacuous
Reverted to the pre-fix `emit-throttle-recommendation.ts` and re-ran the
new tests: all 3 failed exactly as expected (`clearedAtIso` stamped
instead of null, the released episode wrongly closed, the log reason
missing "refresh failed"). Restored and re-verified green.

## Run
- `npx vitest run test/throttleHoldEpisode.test.js`: 22 of 22 pass (3 new:
  the exact QA probe shape end-to-end, plus the pure
  `updateThrottleEpisode` unit cases for both the open-unanswered and
  open-released branches).
- `npx vitest run test/emitThrottleRecommendationCli.test.js test/emitThrottleRecommendationStandingRed.test.js test/releaseIntakeThrottleCli.test.js`:
  67 of 67 pass (no regression from the new optional argument).
- `npm run test:properties -- test/bl1981ThrottleHoldInvariants.property.test.js`:
  3 of 3 pass.
- `npm test` (full unit lane): 652 files, 11159 tests, all pass.
- `npm run test:properties` (full lane): 522 files, 1437 tests, exit 0 (6
  allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"` errors,
  BL-871's own class).
- `node specs/pipeline/cli.js specs/features/BL-1874-...feature`: 2/2 ok.
- `node specs/pipeline/cli.js specs/features/BL-432-auto-tune-intake-throttle.feature`:
  5/5 ok (rides the same episode machinery).

By coder.
