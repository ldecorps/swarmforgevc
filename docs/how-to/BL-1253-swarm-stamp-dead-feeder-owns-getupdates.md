# Stamp-off: dead front-desk feeder owns getUpdates (BL-1253)

BL-848 stamp-off for Cursor/operator hotfix `2ec06b6ef1`, live on `main`
with the trailer `Hotfix-Certification: pending`. Green tests never write
`certified` / `waived` into the hotfix ledger — only a recorded human
decision does ([BL-848](BL-848-certify-an-operator-hotfix.md)).

## Landed behaviour under review

Shared-token inbound queue mode drained an already-empty file while the
bridge's own heartbeat still looked healthy, so the host stayed silent and
`/pilot` piled up unanswered in Telegram. The hotfix gates queue mode on
front-desk poll heartbeat liveness instead of assuming it:

- `extension/src/tools/cursorBridgeInboundQueue.ts` gains
  `frontDeskPollHeartbeatPath` / `readFrontDeskPollHeartbeatMs` over
  `front-desk-poll-heartbeat.json`, returning `null` for a missing or
  unparseable file.
- The bridge re-evaluates feeder liveness on EVERY poll, not once at
  start, and owns `getUpdates` itself whenever the heartbeat reads stale,
  absent, or unparseable — then returns the token once the feeder recovers
  (Scenario 06, carried from retired BL-1260; the dangerous direction is a
  bridge that takes the token and never gives it back, leaving the front
  desk permanently dead while every other liveness signal reads green).
- `start_cursor_bridge.sh` defaults `CURSOR_BRIDGE_INBOUND_QUEUE=0` when
  the feeder is not live at launch.

See also [BL-764](BL-764-front-desk-shared-token-bridge-fanout.md) for the
general shared-token fanout mechanism this hotfix hardens.

## Stamp-off posture

- Confirm or refute the landed commit only — do not reimplement, rewrite,
  redesign, or revert it (constraints on the ticket are firm on this).
- The hotfix ledger row (`backlog/hotfix-ledger.yaml`, commit `2ec06b6ef1`,
  `stamp_ticket: BL-1253`) stays `state: stamp-open` / `human_decision: null`
  until a human `certified`/`waived` ruling, however green the review
  scenarios are.
- Invariant 3 — at most one process calls `getUpdates` on a given bot token
  at any moment, and the token comes back on recovery — was carried forward
  from retired BL-1260 (Article 5.3: a consolidation must not drop a human
  sentence) and is asserted by
  `bl1253TokenOwnershipInvariants.property.test.js`.

## Outstanding human question — the 90-second stall window

Also carried verbatim from retired BL-1260 and still **unanswered**:

> What specifically needs sign-off: THE STALL WINDOW, 90 seconds, and the
> direction it fails in. When the bridge decides the front desk is dead it
> starts calling `getUpdates` on the SAME bot token. If that judgement is
> ever wrong — the front desk still polling but slow or blocked in
> stamping its heartbeat — the result is two pollers on one token, which is
> the Telegram 409 class the bridge has been repeatedly stabilised
> against. So 90s is not a tuning constant; it is the margin between
> "operator gets an answer" and "both readers break". It was picked during
> a live outage. Confirm 90s, or say what margin you want.

The constant is live at `telegramCursorBridgeCore.ts:371`
(`DEFAULT_FRONT_DESK_FEEDER_STALL_MS = 90_000`). This belongs to the
eventual human ledger decision for `2ec06b6ef1` — the row must not be
closed `certified` or `waived` without it.

Acceptance:
`specs/features/BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1.feature`
