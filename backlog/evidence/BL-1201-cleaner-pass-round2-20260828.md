# BL-1201 cleaner pass, re-fix round (2026-08-28)

## What I did

Merged coder handoff `7a65967139` (BL-1201 QA bounce D1 re-fix: the
role-answer note itself now names the CLI, not a bare file path) into the
cleaner worktree. Verified this closes the exact remediation pointer from
`backlog/evidence/BL-1201-qa-bounce-20260828.md` D1: `composeRoleAnswerNoteMessage`'s
pointer-path fallback now emits `answer ready: node
extension/out/tools/deliver-role-answer.js --role <role>` instead of a
bare `.json` path, so a role acting on the literal note text is routed
through `deliverRoleAnswer`'s refuse-a-mismatch / already-consumed
guarantees instead of reading the raw file directly (the exact read that
caused the original incident).

## Merge integrity (BL-954/BL-956 discipline)

Diffed `HEAD` against the sender's tip (`7a65967139`) and against my prior
`HEAD` (`206ed31caf`) — clean auto-merge (no conflicts), and the two diffs
together account for exactly: coder's 3 files (`deliver-role-answer.ts`,
`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCli.test.js`) and my
own 4 prior evidence files, nothing else, nothing dropped from either
side.

## Cleanup Order applied

- Coverage: `npx vitest run test/deliverRoleAnswerCli.test.js
  test/bl1201DeliverRoleAnswer.test.js test/telegramFrontDeskBotCore.test.js
  test/telegramFrontDeskBotCli.test.js` — 732/732 pass (the `blTopicStore`/
  `No such remote 'origin'` lines are expected fixture noise from isolated
  test git repos, not failures).
- 80-char note cap: verified the longest real role name
  (`coordinator`) produces exactly 80 chars — `answer ready: node
  extension/out/tools/deliver-role-answer.js --role coordinator` — at the
  cap, not over it, matching the coder's commit message claim.
- Mutation-site count (BL-485):
  `deliver-role-answer.ts` — 14 sites, within threshold.
  `telegram-front-desk-bot.ts` — 1835 sites, over threshold. Pre-existing:
  this parcel's diff to that file is 13 lines (one small exported helper
  plus a one-line call-site change), not a meaningful contributor to the
  count, and the file was already far over 100 before this ticket. A
  behavior-preserving split of a giant pre-existing module is out of scope
  for a QA-bounce re-fix and is not attempted here — advisory only, no
  action taken, consistent with "never a mechanical line-count chop just
  to duck the count."
- DRY (`jscpd` on both changed files): 0 clones, 0% duplication.
- Structure: `roleAnswerCliInvocation` is a narrow, single-purpose helper
  colocated with `composeRoleAnswerNoteMessage`; no leaked internals, no
  new coupling.

## Verdict

No cleanup changes needed. Forwarding to architect unchanged.
