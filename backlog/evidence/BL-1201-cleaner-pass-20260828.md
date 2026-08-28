# BL-1201 cleaner pass — 2026-08-28

Merged coder handoff `3f09935f60` for BL-1201 (a recorded role answer now
carries the `asked_at_ms` correlator of the question it answers; a
mismatch or already-consumed answer is refused fail-closed rather than
silently handed over). Clean merge, no conflicts.

## Review
`deliverRoleAnswer` is well-structured: fail-closed on any undefined
correlator (never guesses), reads the currently-pending question fresh
(not cached), never destroys answer text (marks `consumedAt` in place).
`writeRoleAnswerFile` stamps the correlator at capture time, matching
`role_ask.bb`'s own `asked_at_ms` literal with no translation step. No
duplication or structural issues.

Checked: `deliverRoleAnswer` is exported but not yet called by any
production call site. Confirmed this is BY DESIGN, not a gap — the
ticket's own `out_of_scope` explicitly excludes "the coordinator's own
relay behaviour" and "the rest of the question-attention-path epic's
delivery work (BL-836...)", stating this ticket is "the pairing defect
underneath them, not new delivery surface." Not the BL-1198/BL-1204
unwired-mechanism shape — no bounce warranted.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run bl1201DeliverRoleAnswer telegramFrontDeskBotCli`: 279/279
  pass (10 new + 271 pre-existing, unmodified, per the ticket's own
  inline-note-path-untouched constraint).
- Acceptance (`BL-1201-a-recorded-answer-identifies-the-question-it-answers.feature`
  via `run_acceptance.sh`): 3/3 pass.
- `bl1201AnswerIdentifiesQuestionSteps.js` fixture: `finally`-guarded
  cleanup; 0 leaked `/tmp/bl1201-*` directories after the run.

By cleaner.
