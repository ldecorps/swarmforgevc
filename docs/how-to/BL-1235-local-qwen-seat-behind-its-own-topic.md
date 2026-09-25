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

## Reachability in production: the front desk must forward the topic too (BL-1384)

The bridge process only polls Telegram itself in a fixture; in production
`runCursorBridgePollOnce` drains a file queue the **front desk** feeds
(`resolveInboundQueueFromFeeder`) while the front desk's own poll heartbeat
is fresh. The front desk forwards a topic to that queue only when
`attemptCursorBridgeTopicExclusion` (`telegramFrontDeskBotCore.ts`) resolves
it as owned by the bridge — and until BL-1384, that adapter list held only
the cursor-host and Bubble topics. `telegram-front-desk-bot.ts` never called
`readQwenLocalTopicId` (already defined in `localQwenSeatLive.ts`) at all,
so a message in the local seat's own topic fell through to a generic
support subject in production, even though this ticket's own acceptance
passed — over fakes where the bridge polls Telegram directly, a path
production never takes.

BL-1384 fixes the feeder side only: the front desk now resolves the local
seat's topic id (`readQwenLocalTopicId`, gated by the same
cursor-bridge-routing-enabled flag) and adds it to the owned-topic list
`decideCursorBridgeExclusion` checks, alongside the cursor and Bubble
topic ids. The bridge side needed **no code change** — a drained update
already took this ticket's own `deps.qwenLocalTopicId` branch — it simply
had no test exercising that path end-to-end before BL-1384 added one. This
ticket's own feature file is unchanged: it still describes the bridge
side, which stayed true throughout; BL-1384 is the feeder-side contract a
seat-behind-a-topic mechanism needs in addition to it (recorded as the
BL-298 shape: a consumer green over fakes while nothing populates its
store in production).

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

**An acceptance fixture that fakes the catalogue must pin `modelId` too
(BL-1680, 2026-09-21).** `resolveLocalSeatModelId`'s explicit-`configured`
argument always wins over `SWARMFORGE_LOCAL_SEAT_MODEL`; a step handler
that fakes the endpoint's catalogue as `[<some-model>]` but calls the real
`runLocalSeatTurn` with no `modelId` still lets the resolver fall through
to the LIVE host's env var — so the fixture is red on any host whose pack
exports a different model (every session exports
`SWARMFORGE_LOCAL_SEAT_MODEL=qwen2.5-coder:latest` today) even though
nothing about the seat itself is broken. `bl1384LocalSeatTopicForwardedSteps.js`'s
fixture now passes `modelId: DEFAULT_LOCAL_SEAT_MODEL_ID` beside a
catalogue of exactly that same constant, so the two can never drift
apart. Any new fixture that drives the real turn function needs the same
pin — a faked catalogue alone is not enough.

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

## The briefing file — project context on every turn (BL-1682)

`readLocalSeatSystemPrompt(targetPath)` reads
[`docs/reference/local-model-briefing.md`](../reference/local-model-briefing.md)
under the target path (`localSeatBriefingPath`) and `runLocalSeatTurn`
passes its trimmed text as ollama's own per-call `system` field, kept
strictly separate from `prompt` — the inbound Telegram text is never
prefixed or rewritten by it. This is what lets the seat answer *about*
SwarmForge rather than as a generic assistant with no idea what the
project is.

- **Missing or empty briefing** — `readLocalSeatSystemPrompt` returns
  `undefined`, `system` is omitted from `completeWithLocalModel`'s
  `JSON.stringify`'d body entirely, and the request is byte-identical to
  the seat's pre-BL-1682 shape. A missing briefing is a working state, the
  same posture `readQwenLocalTopicId` already takes for a missing topic
  binding — never a refused turn.
- **The briefing's own text** is the operator's content (drafted
  2026-09-21, reviewed for factual accuracy by the documenter at parcel
  time — never rewritten wholesale by the coder). Editing it going
  forward is an ordinary docs change to that one file, not a code change.

## Thinking is always off for this seat (BL-1744)

`completeWithLocalModel` sends ollama's own `think: false` on every
completion request, with or without a briefing. Measured live against
qwen3.8-27b-iq3s-seat: with thinking on, a turn spent its whole reply
budget inside an unsuppressed `<think>` block and never answered (132s,
cut off); with `think: false`, the same question answered cleanly in 51s.
This seat's whole purpose is a short spoken-style reply, so thinking is
never made configurable here — a model with no thinking capability
ignores the field.

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

Acceptance: `specs/features/BL-1235-local-qwen-seat-behind-its-own-topic.feature`,
plus `specs/features/BL-1384-the-local-seat-topic-reaches-the-bridge-through-the-front-desk.feature`
for the feeder-side reachability contract above, and
`specs/features/BL-1682-the-local-seat-sends-the-project-briefing-as-its-system-prompt.feature`
for the briefing-file contract.

See also: [BL-1383: a direct-provider chat seat behind its own topic](BL-1383-provider-chat-seat-behind-its-own-topic.md)
— a sibling mechanism, minted from the same intake, that answers inside
the front-desk process itself rather than being forwarded to the bridge.
