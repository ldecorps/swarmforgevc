# A role reopens its own pending question slot (BL-1245)

*How-to. Task-oriented: reopen a pending question slot when the answer never
reached the answer store (e.g., the human answered while the swarm was down).*

## What was happening

`role_ask.bb` permits one pending question per role, tracked at
`.swarmforge/operator/role-awaiting/<role>.json`. [BL-1244](BL-1244-delivered-answer-frees-question-slot.md)
fixes the ordinary case: an answer WAS recorded, and delivering it frees the
slot. This is the case where nothing was recorded at all.

Verified live 2026-08-28: the specifier asked the BL-1191 restart-gate
question. The human answered it verbatim at 10:54Z — "Hold restart, do not
push, wait for QA" — while the swarm was DOWN. No bot ran, so nothing was
written to `role-answers/specifier.json`, and `deliverRoleAnswer` has nothing
to pair: it reports `no-answer` and leaves the marker exactly where it is.
Five hours later the specifier had a new question to raise and got:

```json
{"asked":false,"reason":"already-pending"}
```

There was no expiry, no override, and no supported recovery. The only move
was to read the marker's path out of the source, confirm by hand that the
answer was on record, and move the file aside — which is what happened, and
is not a procedure anyone should have to reinvent.

## What it guarantees now

A role can reopen its own pending question slot by resolving the outstanding
question with a stated reason. The resolve is refused with no reason, reports
plainly when nothing was pending, and preserves the question it resolved —
text, `asked_at_ms`, and the reason — where the already-pending guard can
never read it back as live state.

The resolve command is a new verb on `role_ask.bb`:

```bash
bb swarmforge/scripts/role_ask.bb resolve <role> "<reason>"
```

Examples:

```bash
# Reopen the specifier's slot after confirming the answer was on record
bb swarmforge/scripts/role_ask.bb resolve specifier "Human answered at 10:54Z while swarm was down; answer confirmed on record"

# Reopen with a blank reason — refused, slot stays shut
bb swarmforge/scripts/role_ask.bb resolve coder ""
```

## Where it lives

| Piece | Location |
| --- | --- |
| Resolve verb | `swarmforge/scripts/role_ask.bb` |
| Marker shape (state field, never unlink) | Precedent: GH-26 undeliverable path |
| Preserved record location | `.swarmforge/operator/role-awaiting-archive/<role>-<timestamp>-resolved.json` |
| Pending guard (unchanged) | `operator-lib/role-ask-blocked?` in `swarmforge/scripts/operator_lib.bb` |
| Acceptance | `specs/features/BL-1245-role-reopens-its-own-question-slot.feature` |
| Acceptance steps | `specs/pipeline/steps/bl1245RoleReopensOwnQuestionSlotSteps.js` |

## Verify

```bash
# Raise a question, confirm second ask is refused
bb swarmforge/scripts/role_ask.bb ask specifier "Test question?"
bb swarmforge/scripts/role_ask.bb ask specifier "Another question?"  # Should fail: already-pending

# Resolve with blank reason — refused, slot stays shut
bb swarmforge/scripts/role_ask.bb resolve specifier ""
bb swarmforge/scripts/role_ask.bb ask specifier "Another question?"  # Still refused

# Resolve with real reason — next ask accepted
bb swarmforge/scripts/role_ask.bb resolve specifier "Manual recovery after swarm downtime"
bb swarmforge/scripts/role_ask.bb ask specifier "Another question?"  # Should succeed

# Read preserved record
ls .swarmforge/operator/role-awaiting-archive/
cat .swarmforge/operator/role-awaiting-archive/specifier-*-resolved.json

# Confirm role-awaiting/ holds no pending file
ls .swarmforge/operator/role-awaiting/
```

## Out of scope here

- The recorded-answer case. That is [BL-1244](BL-1244-delivered-answer-frees-question-slot.md),
  and the two are independent: this one is a new verb on `role_ask.bb`, that
  one is the delivery leg in the TypeScript bot.
- [GH-26](GH-25-email-escalation-for-unanswered-role-questions.md)'s
  undeliverable-drop path — already shipped, unchanged.
- Any expiry or timeout on a pending question. A question the human has not
  answered stays pending however long that takes; the fix is a move the role
  can make, not a clock.

## Related

- [BL-1244: A delivered answer frees the role's question slot](BL-1244-delivered-answer-frees-question-slot.md)
- [BL-1201: A recorded answer identifies the question it answers](BL-1201-a-recorded-answer-identifies-the-question-it-answers.md)
- [GH-25: Email escalation for unanswered role questions](GH-25-email-escalation-for-unanswered-role-questions.md)
