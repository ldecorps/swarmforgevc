# BL-1201 hardener pass (round 2) — 2026-08-28

Merged architect handoff `9cb4bd5397` (BL-1201: architect bounce round 3
re-fix — property tests for both declared invariants, `asked_at_ms`
question/answer pairing).

## Received state
- `bl1201DeliverRoleAnswer.property.test.js`: 3/3 green at receipt. P1
  encodes invariant 1 (delivery iff `askedAtMs` matches), P2 encodes
  invariant 2 (the answer text is always recoverable after any delivery
  attempt). Uses the shared `mkTmpDir` helper — no fixture leak risk.
- Acceptance feature: 3/3 green at receipt.

## Stale-build false alarm (not a code defect)
`npx vitest run test/telegramFrontDeskBotCli.test.js` initially showed 2
failures (`BL-607` pointer-fallback tests expecting the message
`answer ready: node extension/out/tools/deliver-role-answer.js --role
specifier`, getting the OLD bare-file-path message instead). Traced to a
stale compiled `out/` in this worktree — I had last run `npm run compile`
before merging this batch's three tickets, and `composeRoleAnswerNoteMessage`'s
new CLI-invocation behavior (BL-1201 QA bounce D1) lives only in `src/`
until recompiled. Confirmed by checking out `9cb4bd5397` alone into a
scratch worktree (`/tmp/bl1201-check`, since removed): the same test passed
there on a fresh compile. Re-ran `npm run compile` in this worktree; all
271/271 `telegramFrontDeskBotCli.test.js` tests pass. This is the
BL-497/"always compile before relying on out/" class, not a regression —
recorded here per that rule's own discipline.

## CRAP / differential complexity
`node scripts/crapReport.js` against the full coverage run flags 14
functions in `telegram-front-desk-bot.ts` over the CRAP<=6 threshold, but
`git diff main` for this ticket's two touched files shows only one new
function (`roleAnswerCliInvocation`, complexity 1, trivial — not in the
flagged list) and a one-line body change to the already-fine
`composeRoleAnswerNoteMessage`. Every flagged function (including
`deliverRoleAnswer` itself) is pre-existing debt this ticket's diff never
touches — per the differential-complexity-gate rule, no regression to fix.

## DRY
`npx jscpd src/tools/deliver-role-answer.ts src/tools/telegram-front-desk-bot.ts --threshold 1` — 0 clones.

## Cleanup
Removed the scratch verification worktree (`git worktree remove --force
/tmp/bl1201-check`) and its scratch script. No orphaned test/mutation
processes.

By hardener.
