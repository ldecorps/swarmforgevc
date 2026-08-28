# BL-1201 cleaner re-verification (deliverRoleAnswer unreachable re-fix) — 2026-08-28

Merged coder's re-fix (`0f1ad334e1`) for the architect's bounce: D1
(`captureRoleAnswer`'s dormant-file leg cleared `role-awaiting/<role>.json`
immediately at capture time, before anything could call `deliverRoleAnswer`
to check it, so every fresh answer read as `mismatch` — never `delivered`)
and D2 (`deliverRoleAnswer` was never called from any production code
path, leaving the original incident — reading `role-answers/<role>.json`
directly — exactly as exposed as before this ticket started). This also
resolves the observation in my own earlier BL-1201 cleaner-pass evidence,
which flagged the unwired function as intentionally out-of-scope per the
ticket's own text — the architect's independent bounce reached the same
gap and coder has now closed it with a proper CLI (`deliver-role-answer.ts`).

## Review
`deliver-role-answer.ts` is a clean thin-wrapper CLI (per this project's
own "CLI main() is a thin wrapper" convention), reusing existing shared
helpers (`makeArgsGuardedMain`, `resolveCliMainWorktreeContext`,
`printJsonToStdout`, `runCliMain`) rather than reinventing. The
role-awaiting-clear split (live-pane leg still clears immediately;
dormant/file leg now only clears via a confirmed `deliverRoleAnswer`
match) is correctly scoped and well-explained. Consolidating onto the
pre-existing `roleAwaitingAnswerPath`/`readRoleAwaitingAnswer` (BL-607)
instead of a second convention is good cleanup on the coder's own part.

Minor, not bounce-worthy: `deliver-role-answer.ts` has no dedicated test
file — but it is a ~15-line wrapper with all real logic
(`deliverRoleAnswer` itself) already covered by 9 cases in
`bl1201DeliverRoleAnswer.test.js`; nothing in the wrapper itself is
untested behavior.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run telegramFrontDeskBotCli telegramFrontDeskBotCore bl1201DeliverRoleAnswer`:
  724/724 pass.
- `vitest run bl1201DeliverRoleAnswer` run 3 times: stable, no flakiness
  (checked given BL-1211's sibling ticket had a hidden fixture flake this
  session).
- Acceptance (`BL-1201-a-recorded-answer-identifies-the-question-it-answers.feature`
  via `run_acceptance.sh`) run 3 times: 3/3 pass every time.

By cleaner.
