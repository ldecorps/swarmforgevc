# Sharing one Telegram bot between the front desk and the Cursor bridge (BL-764)

For the end-to-end Telegram → answer path (and the restricted Operator
constraint), see [How the front desk works](../explanation/how-the-front-desk-works.md).

Telegram hands each `getUpdates` poll result to exactly one caller per bot
token. When the front desk and `telegram-cursor-bridge` (Cursor Remote /
Bubble) are configured with the SAME token, both used to call `getUpdates`,
so Host/Bubble messages landed at whichever process won the race — the front
desk's rule for a bridge-owned topic was to drop the update, so the Host
topic could read as dead (single tick, no reply) while every process reported
healthy.

## Behaviour

1. **One `getUpdates` caller per shared token.** When no dedicated
   `CURSOR_BRIDGE_BOT_TOKEN` is set, the front desk is the sole poller. It
   appends bridge-owned updates (Host/Bubble topic messages, and their
   `callback_query`/`poll_answer` follow-ups) to an on-disk queue instead of
   dropping them (`forwardCursorBridgeUpdate`,
   `extension/src/tools/telegramFrontDeskBotCore.ts`).
2. **The bridge drains the queue instead of polling.** With
   `CURSOR_BRIDGE_INBOUND_QUEUE` enabled, `telegram-cursor-bridge` reads
   `.swarmforge/operator/cursor-bridge-inbound.jsonl`
   (`drainCursorBridgeInboundUpdates`,
   `extension/src/tools/telegramCursorBridgeLive.ts`) instead of calling
   `getUpdates` itself. The drain renames the file before reading it, so an
   append racing a drain is never lost and never double-delivered.
3. **An exclusive token still polls directly.** Setting
   `CURSOR_BRIDGE_BOT_TOKEN` to a token different from the front desk's keeps
   the bridge as its own `getUpdates` caller — the queue is the shared-token
   path only (`shouldUseCursorBridgeInboundQueue`,
   `extension/src/tools/telegramCursorBridgeCore.ts`).
4. **`callback_query` updates are covered too**, not just plain messages —
   a button press in a Host/Bubble topic is forwarded or dropped-with-reason
   the same way a text message is, and never reaches the front desk's
   SUP/Operator dispatch.

## Configuring it

`swarmforge/scripts/start_cursor_bridge.sh`:

- Leave `CURSOR_BRIDGE_BOT_TOKEN` unset (bridge shares `TELEGRAM_BOT_TOKEN`
  with the front desk) to get the queue automatically. The start script
  takes a start-time snapshot of the front-desk heartbeat and marks its own
  decision `CURSOR_BRIDGE_INBOUND_QUEUE_SOURCE=auto` (hotfix
  `c416adc5fb`+`4453766c28`, BL-2060); `shouldUseCursorBridgeInboundQueue`
  ignores an auto-marked value and re-decides from the live per-poll feeder
  liveness instead, so a supervisor started while the front desk was down
  does not carry a stale `0` for its whole life.
- Set `CURSOR_BRIDGE_BOT_TOKEN` to a dedicated token to keep the bridge
  polling directly.
- `CURSOR_BRIDGE_INBOUND_QUEUE=0|1` set WITHOUT the auto marker forces the
  mode explicitly, overriding both the token-based default and the
  per-poll liveness check — an operator's explicit setting always wins.

## A front-desk update the bridge reads is never dropped (BL-2061)

While the bridge holds `getUpdates` itself under [BL-1253's dead-feeder
fallback](BL-1253-swarm-stamp-dead-feeder-owns-getupdates.md) (the front
desk's own poll heartbeat reads stale, absent or unparseable), it still
reads every update on the shared token — including ones that are not its
own, such as an Approve/Reject tap or a typed approval verb meant for the
front desk's Approvals topic. Before BL-2061, the bridge answered the
callback (so the Telegram UI did not hang) and then dropped the update:
the human's tap looked taken, and nothing was recorded.

The bridge now hands over anything outside its own scope instead of
dropping it — the reverse of this doc's forward queue:

1. **The bridge appends, keyed by `update_id`.**
   `handOverToFrontDeskIfNotOwn` (`extension/src/tools/telegramCursorBridgeLive.ts`)
   fires only in dead-feeder fallback mode, only for an update
   `isScopedToCursorTopic` says is not the bridge's own. It still answers
   a handed-over callback query, then appends the raw update to
   `.swarmforge/operator/cursor-bridge-handover.jsonl`
   (`appendCursorBridgeHandoverUpdate`,
   `extension/src/tools/cursorBridgeHandoverQueue.ts`) — an at-most-once
   hand-over, since the update_id this file carries is also the dedup key
   the front desk checks before applying it.
2. **The front desk drains and applies at the top of every poll cycle.**
   `applyHandoverUpdates` (`extension/src/tools/telegramFrontDeskBotCore.ts`)
   runs before the front desk's own `getUpdates` call in `pollAndForward`,
   draining `cursorBridgeHandoverQueue.ts`'s queue and running each
   not-yet-applied update through the SAME `processUpdate` a normal poll
   update goes through — never a second decision path. An update already
   recorded in `cursor-bridge-handover-applied.json`
   (`isHandoverUpdateApplied`/`recordAppliedHandoverId`) is skipped, so a
   hand-over re-appended after a crash is applied at most once however
   many times it is read.
3. **The bridge's own updates are unaffected.** A message in the cursor
   topic is still answered and routed by the bridge itself; nothing is
   handed over for it.

Both queue files share their atomic-rename append/drain primitives with
this doc's forward queue, factored into `jsonlUpdateQueueLib.ts`.

## Liveness cue

The Host topic carries a standing, edit-in-place status line —
`Bridge: busy · N waiting` / `Bridge: idle` — so a stuck queue is visible
without checking logs (`syncCursorBridgeLivenessStatus`,
`extension/src/tools/telegramCursorBridgeLiveness.ts`). It edits the same
message in place rather than posting a new one per turn, and is
change-gated: an unchanged status does not touch Telegram. The idle line
dropped its own `· N waiting` count (BL-811): once idle, a queued question's
actionable surface is the [queue selection poll](BL-810-host-queue-selection-poll-clear-all-and-ttl.md),
not a second ambient counter.

Any OTHER topic (e.g. Bubble) currently holding queued work gets its own
standing cue too, so it doesn't go quiet between the queue ack and the
eventual answer — see
[Queued questions answer where they were asked](BL-767-queued-question-answers-in-origin-topic.md).

## `--help`

`node extension/out/tools/telegram-cursor-bridge.js --help` (or `-h`) prints
usage and exits without opening a poll. Previously the flag was read as a
repo-root path, so a stray `--help` invocation silently became a long-polling
process that could steal updates from the real bridge.

## Where it lives

- Forward queue (front desk → bridge): `extension/src/tools/cursorBridgeInboundQueue.ts`
- Hand-over queue (bridge → front desk, BL-2061):
  `extension/src/tools/cursorBridgeHandoverQueue.ts`
- Shared JSONL append/drain primitives both queues call:
  `extension/src/tools/jsonlUpdateQueueLib.ts`
- Front desk forwarding: `extension/src/tools/telegramFrontDeskBotCore.ts` →
  `forwardCursorBridgeUpdate` (forward), `applyHandoverUpdates` (hand-over)
- Bridge draining / shared-token decision / hand-over:
  `extension/src/tools/telegramCursorBridgeLive.ts` (`handOverToFrontDeskIfNotOwn`),
  `extension/src/tools/telegramCursorBridgeCore.ts`
- Liveness line: `extension/src/tools/telegramCursorBridgeLiveness.ts`
- Launch default: `swarmforge/scripts/start_cursor_bridge.sh`
- Acceptance: `specs/features/BL-764-front-desk-eats-host-bridge-updates.feature`,
  `specs/features/BL-2061-an-update-the-bridge-reads-for-the-front-desk-is-never-dropped.feature`

## Out of scope

- Bubble remote configuration and hold-music catalog (BL-765).
- A queued question's answer posting to the Host topic regardless of
  where it was asked — this was flagged as a likely BL-765 follow-up but
  turned out to be neither BL-765 nor this ticket's mechanism; fixed
  separately, see
  [Queued questions answer where they were asked](BL-767-queued-question-answers-in-origin-topic.md).
