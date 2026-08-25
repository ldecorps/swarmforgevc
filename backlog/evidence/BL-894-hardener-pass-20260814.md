# BL-894 — hardener pass, 2026-08-14 (post D1 fix, re-review)

## Scope

Received from architect as `merge_and_process architect e7a0fdcbe2`
(batched with BL-514, same commit, forwarded separately per Article 2.6).
Reviewed commit `e7a0fdcbe` on top of coder's D1 fix `974adc93ea` ("BL-894:
fix D1 - track superseded queue-poll ids as a bounded history"), which
resolves my own earlier bounce (`backlog/evidence/BL-894-hardener-bounce-
20260814.md`, commit `6097b0bfd`) and the architect's confirming re-review.

This is a legitimate second pass per Article 4.4 (the bounced defect is
now fixed and re-reviewed by the architect; not a first-failure-stop
regression).

## D1 fix verification (independent, not just re-reading the architect's review)

Read the diff directly: `supersededPromptPollId: string | undefined`
replaced by `supersededPromptPollIds: string[]`, written via a new
`appendSupersededPollId` helper (dedupe + cap at 8) from both call sites
(`clearQueuedPollIfStale`, `handleQueueInboundAction`), and
`processQueuedPollAnswer` now checks membership (`.includes`) instead of
scalar equality. Grep confirms no stray reference to the old singular
field remains outside a test/comment mention.

## Checklist run (Article 4.4 — complete inventory)

- Fresh build: `npm run compile` (no `package.json` change, no `npm
  install` needed) — clean.
- Unit suite (`telegramCursorBridgeLive.test.js`): **120/120 green**,
  including the new D1 regression test (two reposts, vote on the
  generation-0 poll — reproduces the exact silent-fallthrough the bounce
  found).
- Full `crap:lets-talk-cursor-bridge` unit scope (26 files): **664/664
  green** on a clean re-run (one file, `startBridgeHeadlessCli.test.js`,
  flaked once earlier in this pass under host load ~115-156 on 4 cores —
  re-ran that file alone and it passed cleanly in 2.8s; unrelated to this
  ticket's diff, which touches neither that file nor its source).
- Property suite (`telegramCursorBridgeLive.property.test.js`): **4/4
  green**, including invariant-1 now swept over `repostCount` 1-4 (the
  exact multi-generation dimension D1 needed).
- Acceptance (`run_acceptance.sh
  specs/features/BL-894-queue-reposts-selection-poll.feature`): **7/7
  green** (was 6, +1 new scenario 03b for the double-repost case).
- Gherkin mutation (BL-113, `soft`, the one Scenario Outline —
  "/queue never permanently redefines where polls are posted"):
  **Total=4 Killed=4 Survived=0 Errors=0**. Manifest stamp written to the
  feature file (per BL-460/BL-502, expected tool behavior, committed).
- DRY (`npm run dry`): 2 pre-existing clones touch
  `telegramCursorBridgeLive.ts` (1119-1126/1145-1152,
  1598-1611/1658-1671). `git blame` on both ranges: `f9b38f53d1`
  (2026-07-29) and `c0f7d4b57a`/`7c0cd3a178` (2026-07-29/08-01) — both
  predate BL-894 (landed 2026-08-14) by 2+ weeks. No new clone introduced
  by the D1 fix.
- CRAP / coverage gate (`npm run coverage:lets-talk-cursor-bridge`):
  **BLOCKED BY** the same pre-existing gap already recorded in my prior
  bounce evidence — `telegramCursorBridgeLive.ts` at 80.8% (1362/1685),
  gate requires 90%. Re-verified this pass is not worsened by D1: read
  `coverage/coverage-final.json` directly and confirmed every new D1 line
  (411, 413, 415, 428, 447, 1448, 1545 — `SUPERSEDED_POLL_ID_HISTORY_LIMIT`,
  `appendSupersededPollId`, and both call sites) has nonzero statement
  count; the only uncovered lines touching the D1 area are pre-existing
  untested branches inside `clearQueuedPollIfStale`'s already-uncovered
  block (e.g. 425-427, the empty-queue branch), unchanged in shape since
  before D1. Not fixed here, not claimed as passing; out of this ticket's
  scope per BL-506 (traces to commits dated 2026-07-28 through 2026-08-08,
  none touching BL-894's diff).
- Mutation (Stryker): **BLOCKED BY** host load — `uptime` during this pass
  showed load averages 100-156 on 4 cores, far above the 2x-cores
  threshold where Stryker's dry run hangs or hard-crashes even at
  concurrency=1 (BL-108/BL-129/BL-139 lesson). Skipped per the office-hours
  mutation bypass; the Gherkin mutation pass above plus the extended
  property test (non-vacuousness independently re-verified by the coder
  and the architect by reverting `appendSupersededPollId` to the old
  scalar behavior and confirming the property fails at repostCount=2)
  substitute for this pass. Full differential Stryker deferred to the next
  quiet pass.
- Orphaned processes / leaked fixture tmux servers: checked before and
  after every run (`pgrep -fl 'node --test|stryker'`, `pgrep -afl tmux`) —
  clean throughout.

## Verdict

D1 fix confirmed closing the gap correctly, independently verified (not
just trusting the architect's review). No new functional test gaps found.
Both blocked items (CRAP/coverage, mutation) are the same pre-existing,
out-of-scope conditions already recorded in my prior bounce pass, and this
review confirms neither is worsened by the fix. Forwarding to documenter.

By hardener.
