# BL-1201 architect bounce (round 3) — 2026-08-28

## Review pass inventory

- **D1 — invariant-unencoded.** The ticket declares two `invariants:`:
  1. "A recorded answer names the question it answers, and a role never
     consumes one whose question it cannot match to its own pending
     question."
  2. "No answer text is destroyed: a consumed or mismatched answer is moved
     aside or marked, never deleted."

  Neither has an executable property test, and no ticket note states a
  non-encodability reason. Property test files DO exist for this area
  (`extension/test/telegramFrontDeskBotCore.property.test.js`,
  `extension/test/telegramFrontDeskBotCli.property.test.js`), but neither
  mentions BL-1201, `asked_at_ms`, or `consumedAt` — grepped, zero hits. Both
  invariants are property-testable over generated `asked_at_ms` pairs and
  answer text:
  - Property 1: for any pending-question `asked_at_ms` Q and any answer
    `asked_at_ms` A, the delivery path reports a match (and consumes) iff
    A === Q; for every A ≠ Q it reports mismatch and the pending question is
    still recorded as pending afterward.
  - Property 2: for any generated answer text and any sequence of
    match/mismatch delivery attempts, the answer's text is always still
    recoverable from disk afterward (moved/marked, never unlinked) —
    generate arbitrary strings including edge cases (empty, very long, past
    `ROLE_ANSWER_NOTE_MAX_LEN`) and confirm no delivery path ever calls an
    unlink/truncate on the answer file's content.

  Only example-based unit/CLI tests exist today
  (`extension/test/bl1201DeliverRoleAnswer.test.js`,
  `extension/test/deliverRoleAnswerCli.test.js`,
  `extension/test/telegramFrontDeskBotCli.test.js`). A missing property test
  is itself the send-back per the Invariants Review section — I did not
  hand-verify the invariants against the example tests as a substitute.

- required_wiring
  (`telegram-front-desk-bot.ts::asked_at_ms`): satisfied —
  `roleAwaitingQuestionAskedAtMs` reads `asked_at_ms` from the role-awaiting
  file (line ~1644) and the answer-write path stamps it onto the recorded
  answer (line ~1678).
- Dependency-rule gate (`extension/out/tools/dependency-gate.js` against
  `telegram-front-desk-bot.ts`, `deliver-role-answer.ts`,
  `telegramFrontDeskBotCli.test.js`): PASSED, no forbidden edges.
- Co-change report: `telegram-front-desk-bot.ts` shows high co-change counts
  with several files, but this is a pre-existing, already-accepted hub-file
  shape (this exact pairing passed a prior architect review,
  `1adad4a40` "architect pass, clean - deliverRoleAnswer re-fix independently
  reproduced fixed") and this round's diff is documentation-only per the
  coder's own note (functional files unchanged from the earlier merge) — not
  a new coupling introduced by this round.
- Correctness read: per the ticket's own note, this round's cited commit
  re-applies only `docs/how-to/BL-1201-*.md` and the `Specification.MD`
  entry after a tip-pure rebuild; the functional code
  (`deliver-role-answer.ts`, `telegram-front-desk-bot.ts`,
  `telegramFrontDeskBotCli.test.js`) is unchanged from the version an earlier
  architect pass already reviewed clean. No new defect found in this round's
  diff.

## Remediation

Coder: add a `*.property.test.js` (or extend
`telegramFrontDeskBotCore.property.test.js`) using fast-check, encoding both
declared invariants above against generated `asked_at_ms` pairs and answer
text. Show each property fails when the invariant is deliberately broken,
then restore. Forward back through cleaner → architect once added.

## Commit reviewed

8f125f661f (cleaner's merge of coder's tip-pure rebuild, doc-only re-apply
per the ticket's own notes).
