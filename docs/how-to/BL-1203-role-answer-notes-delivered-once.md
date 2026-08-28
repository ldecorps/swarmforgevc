# Role-answer notes are delivered once, and the pointer file always matches (BL-1203)

*How-to. Task-oriented: understand why a role answer used to replay, what
the fix guarantees now, and where the mechanism lives.*

## What was happening

`enqueueRoleAnswerNote` (`extension/src/tools/telegram-front-desk-bot.ts`)
is how the Telegram front-desk bot delivers a human's answer to a role
whose pane is dormant: it writes a pointer file under
`.swarmforge/operator/role-answers/<role>.json` and queues a `note`
handoff (as `SWARMFORGE_ROLE=coordinator`) into that role's inbox.

Before this fix it had no working way to tell "already delivered" from
"new answer": a caller that re-ran the same inbound Telegram update could
re-queue the same note indefinitely. Measured on 2026-08-27: 40 duplicate
notes landed in the specifier's mailbox in one day, all priority `00`
(blocking), for a single three-word answer sent once by the human on
2026-08-01.

## What it guarantees now

1. **An answer is delivered once per inbound identity.** Dedup is keyed
   on the Telegram `update_id` that produced the answer — never on the
   answer's text, since two genuinely different answers can share
   wording and both must be delivered. `RoleAnswerFileRecord.seenUpdateIds`
   is a bounded (last 100) history of every `update_id` already captured
   for that role; `enqueueRoleAnswerNote` short-circuits only when the
   incoming `update_id` is already in that history — checking just the
   single most-recent `update_id` is not enough, because a replay
   interleaved with a different, newer answer would otherwise read as
   unseen.
2. **The pointer file always names the answer the note announces.**
   `writeRoleAnswerFile` now writes unconditionally on every delivered
   answer, not only when the answer is too long to inline. Previously a
   short answer left an earlier long-form answer's file stale underneath
   it, so a pointer note could name a file holding a different, older
   answer.
3. **A caller that omits `update_id` (legacy call shape) never dedupes.**
   Idempotency only ever applies to a call that supplies the inbound
   message's identity.

No new extension command or setting — this is an internal delivery-path
fix in the front-desk bot's steering-answer machinery.

## Where it lives

| Piece | Location |
| --- | --- |
| Dedup + pointer-file write | `writeRoleAnswerFile`, `extension/src/tools/telegram-front-desk-bot.ts` |
| Delivery entry point | `enqueueRoleAnswerNote`, same file |
| Real caller wiring | `processSteeringUpdate` → `deliverAskAnswer` → `captureRoleAnswer` → `enqueueRoleAnswerNote` (`update.update_id` threaded through end-to-end) |
| Pointer file | `.swarmforge/operator/role-answers/<role>.json` |
| Acceptance | `specs/features/BL-1203-role-answer-notes-are-delivered-once.feature` |
| Acceptance steps | `specs/pipeline/steps/bl1203RoleAnswerNotesDeliveredOnceSteps.js` |

## Verify

```bash
npx vitest run telegramFrontDeskBotCli telegramFrontDeskBotCore
npx vitest run --config vitest.properties.config.mjs telegramFrontDeskBotCli
node specs/pipeline/cli.js specs/features/BL-1203-role-answer-notes-are-delivered-once.feature
```

## Related

- BL-1205 (tree-collapse guard) and BL-1213 (parcel-rollback guard) —
  sibling `swarm_handoff.sh` send-time gates landed the same session;
  unrelated mechanism, no shared code path.
