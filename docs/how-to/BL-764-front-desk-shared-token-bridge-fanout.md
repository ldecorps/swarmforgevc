# Sharing one Telegram bot between the front desk and the Cursor bridge (BL-764)

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
  with the front desk) to get the queue automatically —
  `CURSOR_BRIDGE_INBOUND_QUEUE` defaults to `1` in that case.
- Set `CURSOR_BRIDGE_BOT_TOKEN` to a dedicated token to keep the bridge
  polling directly.
- `CURSOR_BRIDGE_INBOUND_QUEUE=0|1` forces the mode explicitly, overriding
  the token-based default.

## Liveness cue

The Cursor Remote topic carries a standing, edit-in-place status line —
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

- Queue: `extension/src/tools/cursorBridgeInboundQueue.ts`
- Front desk forwarding: `extension/src/tools/telegramFrontDeskBotCore.ts` →
  `forwardCursorBridgeUpdate`
- Bridge draining / shared-token decision:
  `extension/src/tools/telegramCursorBridgeLive.ts`,
  `extension/src/tools/telegramCursorBridgeCore.ts`
- Liveness line: `extension/src/tools/telegramCursorBridgeLiveness.ts`
- Launch default: `swarmforge/scripts/start_cursor_bridge.sh`
- Acceptance: `specs/features/BL-764-front-desk-eats-host-bridge-updates.feature`

## Out of scope

- Bubble remote configuration and hold-music catalog (BL-765).
- A queued question's answer posting to the Cursor Remote topic regardless of
  where it was asked — this was flagged as a likely BL-765 follow-up but
  turned out to be neither BL-765 nor this ticket's mechanism; fixed
  separately, see
  [Queued questions answer where they were asked](BL-767-queued-question-answers-in-origin-topic.md).
