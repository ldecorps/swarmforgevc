# BL-1203 hardener pass — 2026-08-28

Merged architect handoff `b4498a73a1` (D1 fixture-leak re-fix, verified by
cleaner). Resolved a trivial `specs/pipeline/steps/index.js` conflict
(union of both sides' new step requires, dropped a pre-existing duplicate
`bl1189LiveScreenOnePrimaryWorkingTicketSteps` require that already existed
on this side before the merge).

## Mutation cooldown gate (BL-149)

Both touched production files are inside the 3-day cooldown window
(`file_age_days: 0.26`) — `mutation_cooldown_gate.bb` returned
`skip-cooldown` for both `extension/src/tools/telegram-front-desk-bot.ts`
and `extension/src/tools/telegramFrontDeskBotCore.ts`. No Stryker run this
pass per BL-149; hardening below is a manual coverage-gap review plus a
hand-verified mutant, matching the "best-effort with the existing test
suite" fallback.

## New test added

Found a real coverage gap in `writeRoleAnswerFile`'s history-preservation
branch (`else if (previousSeenUpdateIds?.length) { record.seenUpdateIds =
previousSeenUpdateIds; }`, `telegram-front-desk-bot.ts`): no existing test
exercised a LEGACY (no-updateId) call interleaved between two
identity-keyed calls, so nothing proved the dedup history survives that
interleaving. Added:

- `BL-1203: a legacy call interleaved between identity-keyed calls does
  not erase prior dedup history` (`telegramFrontDeskBotCli.test.js`).

**Hand-verified as a real mutant, not vacuous**: deleted the `else if`
branch in the compiled `out/tools/telegram-front-desk-bot.js`, re-ran the
new test — it failed (3 outbox notes instead of 2, the replayed updateId 1
was no longer recognized as a duplicate after the interleaved legacy
call). Restored the file, recompiled from source, re-ran — passes. This is
exactly invariant 1's failure mode (a replay reads as unseen) surfacing
through a path none of the coder/cleaner/architect's tests reached.

The `ROLE_ANSWER_SEEN_UPDATE_IDS_LIMIT = 100` eviction bound was
considered but not tested: exercising it would require 100+ real
`bb swarm_handoff.bb` subprocess calls (~350-750ms each per the existing
tests), tens of seconds for a single unit test, and no current invariant
or realistic sequence length approaches that bound. Left as a defensive
cap, not a tested behavior.

## Verification

- `npm run compile`: clean.
- `vitest run telegramFrontDeskBotCli telegramFrontDeskBotCore`: 715/715
  pass (was 714; +1 new).
- `vitest run --config vitest.properties.config.mjs telegramFrontDeskBotCli`:
  3/3 pass; `ls /tmp | grep bl1203-property`: 0 matches before and after
  (no fixture leak — architect's D1 fix holds).
- `run_acceptance.sh` on the BL-1203 feature: 2/2 pass.
- CRAP, scoped to both touched files (`node scripts/crapReport.js
  src/tools/telegram-front-desk-bot.ts
  src/tools/telegramFrontDeskBotCore.ts` against a scoped
  `vitest run --coverage telegramFrontDeskBotCli telegramFrontDeskBotCore`
  — the full-suite `npm run coverage` fails ~205 unrelated tests on this
  host for missing `CURSOR_API_KEY`/live-Telegram env, which per BL-863
  skips writing `coverage-final.json` entirely; scoping to the two test
  files avoids that and is sufficient since only these two files' own
  functions are being measured):
  - Every BL-1203-touched/new function is at 100% coverage and at or
    under CRAP 6: `writeRoleAnswerFile` (CRAP 4.00), `enqueueRoleAnswerNote`
    (CRAP 4.00), `readRoleAnswerFile` (CRAP 2.00), `captureRoleAnswer`
    (CRAP 3.00), `attemptSteeringDelivery` (CRAP 3.00), `deliverAskAnswer`
    (CRAP 6.00, at threshold).
  - `processSteeringUpdate` reports CRAP 8.00 (complexity 8, 100%
    coverage) — over threshold, but **not a regression**: BL-1203's diff
    to this function only threads `update.update_id` through an existing
    call (`captureRoleAnswer(...)`) as an added argument, with no new
    branch/conditional. Confirmed by diffing against `main`'s copy of the
    function — identical control flow (same `ignore`/`refuse`
    early-returns, same menuBlock ternary, same `getRolePendingQuestion`
    guard). Complexity is unchanged from `main`; this is pre-existing
    grandfathered debt per the differential complexity gate
    (hardener.prompt), not something BL-1203 introduced or raised.
- DRY (`jscpd`) scoped to both files: one pre-existing clone
  (lines 33-91 vs 96-154 of `telegram-front-desk-bot.ts`, 0.78%
  duplication), entirely outside the BL-1203 change region
  (~lines 1637-1740) — pre-existing, not introduced here.

## Standing whole-tree guards (parcel touches `extension/test/`)

Ran all 12 non-property `*Guard*.test.js` files. 4 files fail (
`liveRepoDerivationGuard`, `tmpDirMigrationGuard`, `tempDirTrapGuard`,
`socketFixtureShortRootGuard`), but every violation listed by each belongs
to files this parcel never touched (e.g.
`pilotMkdtempConventionCheck.test.js`, `docsStructureRealTree.test.js`,
`swarmforge/scripts/local_coder_battery.sh`,
`bl1112StandingUnitRedsSteps.js`) — none name `telegram-front-desk-bot.ts`,
`telegramFrontDeskBotCore.ts`, or any BL-1203 test file. Grepped
`backlog/active|paused|hold` for these filenames first (BL-1063 posture):
`liveRepoDerivationGuard`'s two violations are already covered by
**BL-1209** (todo, paused) and **BL-1212** (todo, paused, depends on
BL-1209) — explicitly named in BL-1212's description. The
`tempDirTrapGuard` violation set matches a previously-reported-but-
undisposed red already in memory
(`temp-dir-trap-guard-property-red-untracked.md`, reported 2026-08-27).
`tmpDirMigrationGuard` and `socketFixtureShortRootGuard` violations are
pre-existing files unrelated to BL-1203, not newly ticketed here — not
this parcel's to fix or block on.

## Cleanup

No orphaned `node --test`/`stryker`/`vitest` processes at handoff
(`pgrep -fl` scoped check, clean). Deleted my own manual verification
scratch dir (`/tmp/bl1203-manual-pn1ntI`) and the hand-mutated
`out/tools/telegram-front-desk-bot.js.bak` backup, both created this pass.
Left `/tmp/bl1203_head.yaml`/`bl1203_qa.yaml` (predate this session,
01:49) and `/tmp/bl1203-acceptance-*` (predate my own `run_acceptance.sh`
invocations) untouched per "never delete what you did not create."

By hardener.
