# BL-1201 — architect pass (2nd review, re-fix), 2026-08-28

Commit reviewed: e05aabcad8 (cleaner, verifying coder re-fix 0f1ad334e1).

## D1 (deliverRoleAnswer unreachable in production) — fixed
`captureRoleAnswer` (telegramFrontDeskBotCore.ts) split into its two legs:
the live-pane leg still clears the marker immediately (never touches the
correlator at all, so no regression there); the dormant/file leg no
longer clears the marker at capture time — `deliverRoleAnswer` is now the
sole clearer, and only after a confirmed match, via the pre-existing
`clearRoleAwaitingAnswer` (not a duplicate `fs.rmSync`).

**Independently re-verified**: re-ran my exact bounce repro (enqueueRoleAnswerNote
then, with no intervening clear, deliverRoleAnswer) against the compiled
module — now returns `{"kind":"delivered", ...}` and the awaiting marker
is gone only afterward. Matches the fix's own claim exactly.

## D2 (nothing called deliverRoleAnswer) — fixed
New `extension/src/tools/deliver-role-answer.ts`: a thin CLI
(`node deliver-role-answer.js --role <role>`) over the existing
`deliverRoleAnswer` export, following the project's CLI main()
thin-wrapper convention (`parseArgs` exported and testable, `main` via
`makeArgsGuardedMain`). This is the mechanism a role/human is meant to run
instead of reading `role-answers/<role>.json` directly.

## Minor (from my prior note) — addressed
The duplicate `roleAwaitingFilePointerPath`/`readRoleAwaitingRecord` was
removed; the fix now reuses the pre-existing `roleAwaitingAnswerPath`/
`clearRoleAwaitingAnswer` (BL-607) via a narrower `readRoleAwaitingAskedAtMs`.

## Regression discipline
The two `telegramFrontDeskBotCore.test.js` cases that had locked in the
OLD (buggy) "dormant leg clears the marker immediately" behavior were
correctly updated to assert the new behavior (`cleared: []` for that leg)
— this is exactly the behavior this fix changes, not a protected suite.
`bl1201DeliverRoleAnswer.test.js` and the acceptance feature's scenario 03
now drive the real `enqueueRoleAnswerNote` → `deliverRoleAnswer` sequence
(no hand-written fixture skipping the clear), directly closing the
verification gap I flagged in the bounce.

## Verification run
- `npm run compile`: clean.
- Independent repro of the bounce's exact scenario: now `delivered`, confirmed.
- `bl1201DeliverRoleAnswer.test.js` + `telegramFrontDeskBotCli.test.js` +
  `telegramFrontDeskBotCore.test.js`: 724/724 pass.
- BL-1201 acceptance feature: 3/3 pass.
- Dependency gate (`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
  `deliver-role-answer.ts`): PASSED.

## Flag for hardener (not a bounce item — coverage is your gate, Article 4.1.3)
`deliver-role-answer.ts`'s own `parseArgs`/`main` CLI wrapper has zero test
coverage — no test file exercises it directly (only the underlying
`deliverRoleAnswer` function is tested). Per the CLI main() thin-wrapper
rule, this needs its own unit test (stubbed argv/cwd) before 100% coverage
can pass.

NONE outstanding for architecture. Forwarding to hardener.

By architect.
