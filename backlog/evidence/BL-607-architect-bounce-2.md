# BL-607 — architect SEND BACK (2nd): a multi-line free-text answer is silently LOST on the dormant-pane leg

**Verdict:** SEND BACK to coder. The compile break from the 1st bounce is fixed
(`npm run compile` green, 5822 unit tests pass, dependency gate PASSED). But a
**concrete, reproduced correctness defect** remains on the dormant-pane answer
leg — the single largest and most load-bearing piece of this ticket — and it
silently loses exactly the human answer the specifier is waiting for, which is
the whole failure mode BL-607 exists to prevent.

## The defect

When the human answers a role's clarifying question with **free text that
contains a newline but is ≤ 80 characters total** (an ordinary multi-line
Telegram reply, e.g. `use option A\nbut rename the flag` — 32 chars, 2 lines),
and the role's pane is **dormant** (the common mono-router case, and the exact
case leg 2 exists for), the answer is silently dropped and the pending-question
marker is cleared as if the answer had been delivered.

Root cause: external text (the human's answer) is embedded verbatim into a
structured `swarm_handoff.bb` draft with **no newline sanitization** —
violating the engineering guardrail *"Strip/escape external text embedded in
structured files."* `swarm_handoff.bb`'s `message:` field is a single line; a
raw newline turns the answer's 2nd line into a bogus header line and the whole
draft is rejected.

## Reproduced end-to-end (all steps verified in this worktree)

1. Human sends a 2-line free-text answer (≤ 80 chars) into the specifier's
   Telegram topic.
2. `decideSteeringAction` preserves it verbatim — reproduced:
   `{"kind":"redirect","role":"specifier","text":"use option A\nbut rename the flag"}`
   (`text` still contains `\n`).
3. Specifier pane dormant → `redirectToRole` returns `no-pane` →
   `enqueueRoleAnswerNote(specifier, text)` (`telegramFrontDeskBotCore.ts:1707-1711`).
4. `composeRoleAnswerNoteMessage` inlines the text **verbatim** because
   `32 <= ROLE_ANSWER_NOTE_MAX_LEN (80)` — the pointer-file fallback only
   triggers on `length > 80`, so a short multi-line answer skips it
   (`telegram-front-desk-bot.ts:1225-1227`). Reproduced output:
   `"use option A\nbut rename the flag"` (contains newline: true).
5. The draft written by `enqueueRoleAnswerNote` (`telegram-front-desk-bot.ts:1257`)
   becomes:
   ```
   type: note
   to: specifier
   priority: 00
   message: use option A
   but rename the flag
   ```
6. `swarm_handoff.bb` **rejects** it — reproduced verbatim:
   ```
   HANDOFF INVALID: .../draft.txt
   Errors:
   - Line 5: expected 'field: value'.
   ```
   exit code 2.
7. `enqueueRoleAnswerNote` catches the non-zero exit and returns `false`
   (`telegram-front-desk-bot.ts:1262-1264`).
8. **That `false` return is ignored** at both call sites
   (`telegramFrontDeskBotCore.ts:1459` and `:1709`), and
   `clearRolePendingQuestion(role)` runs unconditionally (`:1461` / `:1711`).
9. Net effect: the human's answer is gone, no trace, and the "one pending
   question per role" guard is released as if the answer had landed. The
   specifier resumes with no answer and makes the unilateral judgement call the
   ticket exists to prevent.

This is not exotic: multi-line short answers are ordinary human input, the
dormant pane is the *common* mono-router state, and free text is a
*non-negotiable* answer channel per the ticket itself.

## Remediation (coder's choice; either fixes the blocking defect)

**Primary (blocking):** guarantee the note `message:` is always a single line
≤ 80 chars while the *full* answer still reaches the role.

- Option A (preferred — lossless): in `composeRoleAnswerNoteMessage`, treat an
  answer that is **not a clean single line ≤ 80 chars** as "does not fit" and
  route it through the existing pointer path — write the full text to
  `.swarmforge/operator/role-answers/<role>.json` (already implemented by
  `writeRoleAnswerFileIfNeeded`) and put the single-line `answer ready: <path>`
  pointer in the note. Extend the current `text.length > 80` test to also fire
  when `text` contains a newline (or any control char). The role recovers the
  exact multi-line answer from the pointer file.
- Option B (simpler, lossy): collapse newlines/whitespace in the inlined
  message and re-check the 80-char cap *after* collapsing. Loses the answer's
  line structure, so Option A is preferable.

Add a unit or acceptance case for a **multi-line ≤ 80-char dormant-pane
answer** proving the queued note validates through `swarm_handoff.bb` and the
full answer text is recoverable by the role.

**Secondary (recommended, not strictly blocking):** the failure is *silent*
because `enqueueRoleAnswerNote`'s boolean result is discarded at both call
sites while the pending marker is cleared regardless. The adjacent Operator
path (`postToBridge`, `telegramFrontDeskBotCore.ts:1465-1469`) gates its
message-edit and its delivery outcome on confirmed delivery; the role path
should mirror that — do not clear the pending marker (and reflect failure in
the outcome) when the answer was captured by *neither* leg, so a future
enqueue failure cannot be swallowed without a trace. Apply the same newline
sanitization to the button-tap path's `answerLabel` (`:1459`) for
defense-in-depth (option labels are author-controlled, so lower risk).

## What is NOT the problem (so you don't over-correct)

- **Architecture is clean.** Dependency-rule hard gate PASSED on all three
  changed TS sources (`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
  `telegramTopicDecisions.ts`) — no forbidden edges. The two-layer boundary,
  host-owns-I/O split (`role_ask.bb` owns state, TS owns Telegram, the dormant
  leg correctly shells `swarm_handoff.bb` rather than hand-writing `inbox/new/`),
  no-webview-storage, and secrets-stay-in-host-env are all respected. The
  cleaner's `telegramTopicDecisions` extraction and its restored re-export
  barrier are fine. Do NOT undo any of that — the only defect is the unsanitized
  answer text on the dormant leg.
- The specifier.prompt wiring (invocation, free-text fallback, one-pending, and
  the NO-POLLING/end-your-turn contract) reads correctly.

(Reproduce: a 2-line answer ≤ 80 chars → `composeRoleAnswerNoteMessage` inlines
it → the resulting draft fails `swarm_handoff.bb` validation with
`Line N: expected 'field: value'`.)

— By architect.
