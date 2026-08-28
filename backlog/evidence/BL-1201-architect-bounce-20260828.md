# BL-1201 — architect bounce (1st), 2026-08-28

Commit reviewed: e89696aa33 (cleaner, verifying coder work 3f09935f6).

## Architecture / dependency-gate / co-change
Dependency gate: PASSED, no forbidden edges. Co-change flagged
`extension/src/tools/telegramFrontDeskBotCore.ts` (78 co-changes with the
touched file, not touched by this commit) — this is exactly the file
containing the real production capture flow that D1 below is about; the
tool's signal corroborates the manual finding.

## D1 — `deliverRoleAnswer`'s "delivered" verdict is unreachable in production for the ordinary case (behavior, CRITICAL)

The real production capture sequence, `captureRoleAnswer`
(`extension/src/tools/telegramFrontDeskBotCore.ts:1970-1981`), is:

```ts
const captured = delivered || (await enqueueRoleAnswerNote?.(role, answerText, updateId)) === true;
if (captured) {
  await clearRolePendingQuestion?.(role);   // -> clearRoleAwaitingAnswer, unlinks role-awaiting/<role>.json
}
```

`enqueueRoleAnswerNote` (which calls the new `writeRoleAnswerFile`,
stamping `askedAtMs` from the role-awaiting file) is immediately followed,
in the SAME capture event, by `clearRolePendingQuestion` — which deletes
`role-awaiting/<role>.json`. This happens at CAPTURE time, not at
delivery/consumption time.

`deliverRoleAnswer` (the new function) requires `role-awaiting/<role>.json`
to still exist and match at the moment it is CALLED:

```ts
if (answer.askedAtMs === undefined || awaiting?.asked_at_ms === undefined || answer.askedAtMs !== awaiting.asked_at_ms) {
  return { kind: 'mismatch' };
}
```

But by the time anything could call `deliverRoleAnswer` — necessarily
AFTER capture, since capture is what produces the answer file in the first
place — `role-awaiting/<role>.json` has already been deleted by
`clearRolePendingQuestion` (assuming no new question was asked in the
interim). So `awaiting?.asked_at_ms` is `undefined`, and `deliverRoleAnswer`
reports `'mismatch'` for the exact fresh, correctly-paired case — never
`'delivered'`. This is not a corner case; it is the ONLY case that matters
in production, since capture always runs before any hypothetical delivery.

**Empirically reproduced** (not inferred) by calling the compiled module
directly with the real production sequence:
```js
await enqueueRoleAnswerNote(root, 'specifier', 'archive under handoffs root');
clearRoleAwaitingAnswer(root, 'specifier');   // captureRoleAnswer's own next line
const result = deliverRoleAnswer(root, 'specifier');
// => { kind: 'mismatch' }   -- NOT 'delivered'
```
Full repro script and output in this file's evidence trail (run against
`out/tools/telegram-front-desk-bot.js` after `npm run compile`).

The coder's own "delivered" unit test
(`bl1201DeliverRoleAnswer.test.js`, "enqueueRoleAnswerNote stamps the
currently-pending question's askedAtMs onto the recorded answer") calls
`enqueueRoleAnswerNote` in isolation and then `deliverRoleAnswer`
immediately — WITHOUT the `clearRoleAwaitingAnswer` step
`captureRoleAnswer` always performs in the same real capture event. That
test is a false positive: it does not reflect the actual call sequence a
real answer goes through, so it never exercises the defect above. Same gap
in the acceptance feature (`bl1201AnswerIdentifiesQuestionSteps.js`) — all
three scenarios seed both files directly via hand-written fixtures, never
driving the real `enqueueRoleAnswerNote` → `clearRoleAwaitingAnswer`
sequence.

## D2 — `deliverRoleAnswer` is never called from anywhere in production (behavior/completeness, HIGH)

`grep -rn "deliverRoleAnswer(" extension/src/` (excluding tests) returns
only the function's own definition. No CLI, no role-prompt reference, no
wiring into the note-delivery or steering-answer flow calls it. The
ticket's own commit message calls it "the sole consumption path — the
only way a role should ever act on a role-answers file", but nothing
routes a role or human through it. The original incident (a role/human
reading `.swarmforge/operator/role-answers/<role>.json` directly, via the
bare "answer ready: `<path>`" note pointer, with no correlator check) is
**unchanged** by this commit — the file now CARRIES a correlator, but
nothing forces anyone reading it to check it.

D1 and D2 compound: fixing D2 alone (wiring some future caller to
`deliverRoleAnswer`) would hit D1 and refuse every genuine answer forever;
fixing D1 alone leaves the mechanism unreachable and the incident
unprevented either way. Both need to be addressed together.

## Minor (non-blocking, noted for the record)
`roleAwaitingFilePointerPath(role)` (new, this commit) and the
pre-existing `roleAwaitingAnswerPath(targetPath, role)` both resolve the
identical `.swarmforge/operator/role-awaiting/<role>.json` path via two
different signatures/conventions. Not a correctness defect, but worth the
coder's attention while reworking this area — prefer reusing the existing
one or consolidating, rather than a third convention appearing later.

## Everything else checked — clean
| Check | Result |
|---|---|
| `required_wiring` (askedAtMs stamped in `writeRoleAnswerFile`) | Present, correct |
| Invariant 2 (no answer text destroyed) | Encoded and correct — `consumedAt` marks in place, never deletes |
| Existing 271 `telegramFrontDeskBotCli.test.js` cases + `telegramFrontDeskBotCore.test.js` | All pass, unmodified |
| Dependency gate | PASSED |

## Routing
Per Article 4.3, owning stage is **coder** — this is a wiring/integration
defect in the fix's own production call path, not a spec ambiguity; the
ticket's own text already specifies the intended refuse/deliver behavior.

By architect.
