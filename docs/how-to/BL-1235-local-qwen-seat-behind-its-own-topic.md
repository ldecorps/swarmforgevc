# A local Qwen seat behind its own Telegram topic (BL-1235)

## What it is

A **third** host-agent seat, backed by a local model served through ollama,
reachable **only** in its own dedicated Telegram topic
(`t.me/c/4415865297/41004`). Per the human's own directive (2026-08-28,
verbatim): "cursor stays behind the usual host topic and front desk" — this
seat adds a new surface beside Cursor's, it does not move, wrap, or replace
Cursor anywhere.

## Where it lives

`telegramCursorBridgeCore.ts` already carried the pattern for a subject
resolved from a topic: `CURSOR_BRIDGE_SUBJECT_ID = 'CURSOR_REMOTE'` and
`BUBBLE_SUBJECT_ID = 'BUBBLE'`, both resolved against
`.swarmforge/operator/cursor-bridge-topic-map.json`. `QWEN_LOCAL` is a third
entry in that same map — a sibling of what was already there, not a new
mechanism. The live operator binding (`{"41004": "QWEN_LOCAL"}` in that
gitignored file) is runtime state written on the host, the same class of
operational step as installing ollama or pulling the model — not part of
this ticket's build.

The decision logic lives in `extension/src/tools/localQwenSeat.ts`
(`decideLocalSeatTurn`, `resolveLocalSeatModelId`,
`formatLocalSeatAcknowledgement`); the live I/O — reading the endpoint,
calling the model, posting back — lives in `localQwenSeatLive.ts`, wired
into `processInboundUpdates` in `telegramCursorBridgeLive.ts`.

## Cursor's surfaces are protected two ways, not one

"Cursor stays behind the usual host topic and front desk" is enforced
structurally, in two places that back each other up:

1. `decideLocalSeatTurn`'s FIRST clause returns `not-mine` for any topic
   that is not the seat's own — before the endpoint, the model, or anything
   else is even considered. There is no path on which the local seat
   answers on Cursor's surfaces, including when the seat's own endpoint is
   down: a seat that helpfully announced "I am broken" on Cursor's topic
   would still be answering there, which the directive forbids just as much
   as a real reply would.
2. `QWEN_LOCAL` is deliberately **not** added to `CursorBridgeTopicScope`.
   The cursor bridge's `decideInboundGate` ignores anything outside that
   bag, so leaving the seat's topic out of it makes the exclusion
   structural rather than a filter someone could forget to apply.

In the live dispatch, the seat's turn is handled **before**
`decideInboundAction` is consulted at all — a message in the seat's topic
never reaches Cursor's decision path, and (since a Telegram bot token has
exactly one `getUpdates` consumer) this runs inside the bridge's existing
poll rather than as a second poller, which would immediately 409 and take
the front desk down.

## The model tag is configuration, checked live — never a hardcoded guess

The ticket could not verify an exact tag at mint time and refused to guess
one into a constant. The human later answered directly, choosing
**`qwen3:14b`** (over the ticket's own guessed `qwen2.5-coder:14b`) from the
models actually pulled on the host. That answer is the DEFAULT, not a
hardcoding: `resolveLocalSeatModelId` takes an explicit config value first,
then `SWARMFORGE_LOCAL_SEAT_MODEL`, then the default — and whichever tag it
lands on is still checked against the endpoint's own catalogue at seat
time, so a wrong or unpulled tag is a visible refusal naming what the
endpoint actually holds, never a silent fallback to something else.

## The turn is slow, and the seat says so up front

Measured on the host that first ran this (no dedicated GPU, CPU-only
inference): a real turn (2046-token prompt, 289-token reply) took **3m19s
at ~2.8 tok/s**. Without a first word, the topic would look dead for
minutes and read as a broken seat. `formatLocalSeatAcknowledgement` posts
first — before the completion call — naming the model and saying a reply
can take several minutes. A completion that throws becomes a refusal
carrying the endpoint's own error text, posted in the same topic; a `not
mine` decision posts nothing at all. A completion of pure whitespace is
trimmed before posting, so it can never read as a blank, broken-looking
message.

## Refusal is never silent

Every non-`answer` decision (`endpoint down`, `endpoint unhealthy`, `model
absent`, `no model configured`) carries the underlying reason and hands the
turn to nobody — there is no fallback/delegate/escalate case in the
decision type, so there is nothing for a caller to route around even by
accident.

## Verifying

1. `node extension/out/tools/named-model.js pull <configured-model>` then
   `serve <configured-model>`; confirm the endpoint reports healthy.
2. Post a message in topic `41004` and confirm the reply comes back in that
   topic, visibly from the local model, with an acknowledgement posted
   first.
3. Post in the usual host topic and in the front desk; confirm both are
   still answered by Cursor and the local seat never responds there.
4. Stop the endpoint, post again in `41004`, and confirm the topic shows
   the actual failure reason — never a bare status code, never silence.
5. Configure a model the endpoint does not hold, post again, and confirm
   the topic names it unavailable and no other seat answers in its place.

## Out of scope

Moving, wrapping, or replacing Cursor anywhere (explicitly refused by the
human directive); installing ollama and choosing the final model tag (both
operational runs over BL-1082's shipped pull/serve path, not builds);
staffing pipeline roles with a local model (the separate local-model pack
family — BL-1143 cold-swap, BL-1140 bake-off, BL-1127 evidence bar); and
renaming Telegram/Cursor identifiers for interface purity — even though
this is the genuine second host incarnation local-engineering rule 7
requires before that split would earn a second name, it licenses this seat
alone, nothing else.

Acceptance: `specs/features/BL-1235-local-qwen-seat-behind-its-own-topic.feature`.
