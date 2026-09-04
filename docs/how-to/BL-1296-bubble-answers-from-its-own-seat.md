# Bubble answers from its own seat, while Cursor is busy (BL-1296)

## What it is

Bubble (the phone-app topic, `BUBBLE` in
`.swarmforge/operator/cursor-bridge-topic-map.json`) used to be a pure
**mirror**: both the Cursor host topic and the Bubble topic routed to the
same single answering path, so whenever that path was mid-turn Bubble could
not answer either. `runBubbleSeatTurn`
(`extension/src/tools/bubbleSeatLive.ts`) is Bubble's own dispatch: a message
in Bubble's topic is answered without asking Cursor's own dispatch path
anything at all, riding the seat/topic-map shape BL-1235 already shipped for
the local qwen seat rather than inventing a second mechanism.

## The human's ruling: strict echo, not a second brain

The human's ruling (2026-09-03, recorded on the ticket's `human_ruling:`)
picked **option 1 of three** — "the Bubble seat relays the front desk's own
answer and produces none of its own" — over a dedicated paid agent session
or a local-model worker. `runBubbleSeatTurn` drives the same turn the Let's
Talk surface drives (`processLetsTalkTurn`, against
`createLiveCursorBridgeAgentSession`) and posts back exactly what that
returns, unedited. There is no code path in `bubbleSeatLive.ts` that
composes a reply of its own — invariant 1 ("the Bubble seat never diverges
from the front desk") is enforced by that module simply containing no such
path, not by a check someone could forget.

## Where it lives in the dispatch

`tryDispatchToBubbleSeat` (`extension/src/tools/telegramCursorBridgeLive.ts`)
runs inside the bridge's existing poll loop, **before**
`decideInboundAction` (Cursor's own gate) is consulted at all, gated on
`inbound.topicId === deps.bubbleSeatTopicId`. `decideBubbleSeatTurn`
(`extension/src/tools/bubbleSeat.ts`) is the structural guard behind that:
its first clause returns `not-mine` for any topic that is not Bubble's own,
before anything else is considered, so there is no path on which this seat
answers Cursor's host topic or the front desk (invariant 2). The seat opens
no second `getUpdates` consumer — it runs inside the bridge's own poll, the
same way BL-1235's seat does (invariant 3).

`cursorBusy` is accepted on the decision input and deliberately **never
read** — Bubble used to wait behind that flag, which is the defect this
ticket removes, so a future edit that starts consulting it again would be
reintroducing it. That is why the field exists and is commented rather than
just deleted.

## A refusal is never silent

When the front desk cannot answer (an exception, or a reply that trims to
empty), `decideBubbleSeatTurn` returns `refuse` with a reason, and
`formatBubbleSeatRefusal` posts that reason into Bubble's own topic — never
silence, and never a hand-off to another seat. `runBubbleSeatTurn` treats a
thrown edge from the front desk turn itself the same way: caught and turned
into a `refuse`, not an unhandled rejection.

## Verifying

1. Occupy the Cursor seat with a long turn (a piloted expedite or an
   equivalent long sweep) and, while it is still in flight, send a message to
   the Bubble topic from the phone; confirm it is answered.
2. Send a message to the Cursor host topic and confirm Bubble's worker did
   not answer it; send one to Bubble's topic and confirm Cursor's dispatch
   never sees it.
3. Stop or break the front desk turn and confirm Bubble's topic shows the
   actual refusal reason, never silence.
4. Confirm only one `getUpdates` owner exists throughout (no 409s in the
   bridge log) and the bridge does not restart.

## Out of scope

A dedicated paid agent session or a local-model worker for Bubble (both
considered in the ruling and not chosen); any change to Cursor's host topic
or the front desk's own routing, which this ticket leaves untouched.

Acceptance: `specs/features/BL-1296-bubble-answers-from-its-own-seat.feature`.
