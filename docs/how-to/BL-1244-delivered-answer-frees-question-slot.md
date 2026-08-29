# A delivered answer frees the role's question slot (BL-1244)

*How-to. Task-oriented: understand why a role's next clarifying question
used to be refused after an answer it had already acted on, and what
changed.*

## What was happening

`role_ask.bb` permits one pending question per role, tracked at
`.swarmforge/operator/role-awaiting/<role>.json`. Per [BL-1201](BL-1201-a-recorded-answer-identifies-the-question-it-answers.md)'s
architect bounce D1, `captureRoleAnswer` clears that marker only on the
live-pane delivery leg; on the dormant/file leg it enqueues the answer note
and deliberately leaves the marker for `deliverRoleAnswer`
(`extension/out/tools/deliver-role-answer.js`) to clear once it has
confirmed the pairing. That CLI runs from exactly one place: a role
invoking it by hand.

Nothing invoked it, and nothing told a role to. When the answer was short
enough to ride inline in the note — a tapped option label almost always is
— the role received the answer text, acted on it, and never learned there
was anything left to consume. The marker stayed set. The role's *next*
question was refused as already-pending, silently, on a question that had
already been answered and acted on minutes or hours earlier.

Verified live 2026-08-28: an answer was recorded, delivered inline, and
acted on at 12:54; the marker was still present at 13:01, unmodified since
the question was first asked. Running the CLI by hand cleared it
immediately — the mechanism worked, nothing was reaching it.

This corrects [BL-1201](BL-1201-a-recorded-answer-identifies-the-question-it-answers.md)'s
own "What it guarantees now" point 5 ("An answer short enough to ride
inline in the note still arrives inline, with no file written and nothing
to correlate"): the dormant/file leg writes an answer file and enqueues a
note even when that note's payload happens to be short enough to read as
plain text. There was always something to correlate; nothing was doing it.

## What it guarantees now

The delivery leg itself now confirms the pairing and clears the marker the
moment the note is successfully enqueued — the note **is** the delivery,
so this is the honest moment to do it. `captureRoleAnswer`
(`telegramFrontDeskBotCore.ts`) gained an optional adapter,
`confirmRoleAnswerDelivery`, invoked only when `enqueueRoleAnswerNote`
returns `true` (a failed enqueue delivered nothing, so nothing is
confirmed). It is wired in `telegram-front-desk-bot.ts` to
`deliverRoleAnswer` itself — still the only reader of
`role-answers/<role>.json` (BL-1201 D2) — so BL-1201's pairing check is
reused verbatim, never re-implemented:

- A recorded answer whose `askedAtMs` matches the role's currently pending
  question clears the marker and marks the answer consumed.
- A mismatched `askedAtMs`, or no recorded answer at all, leaves the slot
  shut — unchanged, and untouched by this ticket.

A role no longer needs to run the CLI by hand for this to happen; it is a
side effect of the answer reaching the role at all, on both capture sites
(the free-text steer path and the button-tap path).

## Where it lives

| Piece | Location |
| --- | --- |
| New adapter, invoked on successful enqueue | `captureRoleAnswer`, `extension/src/tools/telegramFrontDeskBotCore.ts` |
| Adapter wired to `deliverRoleAnswer` | `buildPollAdapters`, `extension/src/tools/telegram-front-desk-bot.ts` |
| Underlying pairing check (unchanged) | `deliverRoleAnswer`, same file — see [BL-1201](BL-1201-a-recorded-answer-identifies-the-question-it-answers.md) |
| Acceptance | `specs/features/BL-1244-a-delivered-answer-frees-the-question-slot.feature` |
| Acceptance steps | `specs/pipeline/steps/bl1244DeliveredAnswerFreesQuestionSlotSteps.js` |

## Verify

```bash
npx vitest run telegramFrontDeskBotCore bl1244DeliveredAnswerFreesQuestionSlot
node specs/pipeline/cli.js specs/features/BL-1244-a-delivered-answer-frees-the-question-slot.feature
```

## Out of scope here

- The case where the answer never reached `role-answers/` at all — the
  human answers while the swarm is down, so nothing records anything and
  `deliverRoleAnswer` has nothing to pair. That leaves the role with no
  move whatsoever and is BL-1245, a separate mechanism.
- [GH-26](GH-25-email-escalation-for-unanswered-role-questions.md)'s
  undeliverable-drop path — already shipped, unchanged. Same wedge (a gate
  refusal reaching someone with no action available, after the condition
  accumulated invisibly), fourth distinct cause: BL-1237, BL-1240, BL-1241
  were the first three.
- BL-1201's correlator itself — recording `askedAtMs`, refusing a
  mismatch, retiring a consumed answer. Reused here, not touched.
