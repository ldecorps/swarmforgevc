# A recorded answer identifies the question it answers, and roles consume it via a CLI, not a raw read (BL-1201)

*How-to. Task-oriented: understand why a stale answer used to look fresh,
what the fix guarantees now, and how a role should act on an "answer ready"
note going forward.*

## What was happening

`.swarmforge/operator/role-answers/<role>.json` recorded a human's answer as
`{ text, recordedAt }` — keyed by role name alone, with no reference to
which question it answered, and never cleared once consumed. When an answer
was too long to inline in a note, the coordinator forwarded a bare pointer:
`"answer ready: .swarmforge/operator/role-answers/<role>.json"`.

Caught live 2026-08-27: the specifier received that pointer note and the
file it named held an answer **recorded five days earlier**, already
consumed and quoted verbatim in an unrelated, already-approved ticket. The
role's actually-pending question, tracked separately in
`.swarmforge/operator/role-awaiting/<role>.json`, was about something else
entirely. Nothing about the note, the file, or the store said which
question the answer belonged to — the specifier caught the mismatch only
because the two questions happened to be about unrelated things. Two
questions of similar shape would have produced a role acting confidently on
the human's answer to something else.

## What it guarantees now

1. **A recorded answer carries the `asked_at_ms` of the question it
   answers.** `writeRoleAnswerFile` stamps the value straight off
   `role_ask.bb`'s own `role-awaiting/<role>.json` marker at capture time —
   the same correlator both the Babashka question-writer and the TypeScript
   answer-writer agree on, with no translation step between them.
2. **`deliverRoleAnswer` refuses a mismatch instead of handing it over.** If
   the recorded `askedAtMs` doesn't equal the role's *currently* pending
   question's `asked_at_ms` — including the case where no question is
   currently pending at all — the result is `{ kind: 'mismatch' }` and the
   pending question (if any) stays pending. An answer captured with no
   question pending never later matches a question that becomes pending
   afterward; `undefined` has no identity to correlate against, so it is
   fail-closed.
3. **A consumed answer stops looking fresh.** A confirmed match marks
   `consumedAt` on the record in place and returns `{ kind:
   'already-consumed' }` on any later read — the record is never deleted,
   so no answer text is ever destroyed, but it no longer presents itself as
   an unread pointer.
4. **The awaiting-question marker survives until something actually
   consumes the answer.** The dormant/file capture leg used to clear
   `role-awaiting/<role>.json` immediately at capture time, in the same
   event that stamped `askedAtMs` from that same marker — which meant the
   marker was always already gone by the time anything could call
   `deliverRoleAnswer`, so the "delivered" verdict was unreachable for
   every genuine, correctly-paired answer (only ever produced `'mismatch'`).
   Only `deliverRoleAnswer`, on a confirmed match, now clears it. The
   live-pane delivery leg (direct pane injection, no file/correlator
   involved) is unchanged — it still clears the marker immediately, because
   that leg never touches this file at all.
5. **The inline-note path is unaffected.** An answer short enough to ride
   inline in the note (≤80 chars) still arrives inline, with no file
   written and nothing to correlate.
6. **The pointer note itself now names the CLI, not the raw file.**
   QA's own D1 bounce on this ticket caught that
   `composeRoleAnswerNoteMessage` still emitted `"answer ready:
   .swarmforge/operator/role-answers/<role>.json"` — byte-identical to
   before the fix — so a role acting on the note exactly as written still
   read the raw file directly and got none of `deliverRoleAnswer`'s
   guarantees; the correlator fix was reachable from a test or from this
   doc, but not from the production note a role actually receives. Fixed:
   `roleAnswerCliInvocation(role)` now composes `node
   extension/out/tools/deliver-role-answer.js --role <role>`, and the
   pointer branch of `composeRoleAnswerNoteMessage` emits `"answer ready:
   <that invocation>"` instead of the bare path — the note text itself
   carries the enforcement now, not only docs a role was never told to
   read.

## How a role should act on an "answer ready" note

The pointer note a role actually receives now reads, e.g.:

```text
answer ready: node extension/out/tools/deliver-role-answer.js --role coordinator
```

Run the command the note names — that **is** the CLI, not a bare file
path to read directly. The underlying
`.swarmforge/operator/role-answers/<role>.json` file still exists on disk,
but reading it directly bypasses the correlator check entirely (exactly
the read that produced the original incident) and is never the right way
to act on this note.

```bash
node extension/out/tools/deliver-role-answer.js --role <role>
```

It runs `deliverRoleAnswer` and prints one of:

| `kind` | Meaning |
| --- | --- |
| `delivered` | Confirmed match — `text` is the answer, safe to act on; the awaiting-question marker is now cleared. |
| `mismatch` | The recorded answer's question does not match the role's currently pending question (or none is pending). Do not act on it. |
| `already-consumed` | This answer was already delivered once; nothing new to act on. |
| `absent` | No answer file exists for this role. |

## Where it lives

| Piece | Location |
| --- | --- |
| Correlator stamp on capture | `writeRoleAnswerFile`, `extension/src/tools/telegram-front-desk-bot.ts` |
| Refuse/consume logic | `deliverRoleAnswer`, same file |
| Pointer note names the CLI | `roleAnswerCliInvocation` / `composeRoleAnswerNoteMessage`, same file (QA D1 re-fix) |
| CLI entry point | `extension/src/tools/deliver-role-answer.ts` → `node deliver-role-answer.js --role <role>` |
| Capture-time wiring (marker survives until consumption) | `captureRoleAnswer`, `extension/src/tools/telegramFrontDeskBotCore.ts` |
| Answer pointer file | `.swarmforge/operator/role-answers/<role>.json` |
| Awaiting-question marker | `.swarmforge/operator/role-awaiting/<role>.json` (written by `role_ask.bb`) |
| Acceptance | `specs/features/BL-1201-a-recorded-answer-identifies-the-question-it-answers.feature` |
| Acceptance steps | `specs/pipeline/steps/bl1201AnswerIdentifiesQuestionSteps.js` |

## Verify

```bash
npx vitest run bl1201DeliverRoleAnswer deliverRoleAnswerCli telegramFrontDeskBotCore
node specs/pipeline/cli.js specs/features/BL-1201-a-recorded-answer-identifies-the-question-it-answers.feature
```

## Out of scope here

- BL-836 and the rest of the question-attention-path epic's delivery work —
  this is the pairing defect underneath them, not new delivery surface.
- The coordinator's own relay behaviour, unchanged — it forwarded the
  pointer note faithfully; the pointer itself was what could not be
  trusted.
- Cleaning up pre-existing stale `role-answers/*.json` files by hand — local
  runtime state; the fix makes any leftover ones harmless (a fresh question
  simply never matches a stale answer's `askedAtMs`).
