# BL-1235 — a local qwen seat behind its own topic

Coder, 2026-08-30.

## The directive this is measured against

> To be clear, cursor stays behind the usual host topic and front desk.
>
> I want local qwen only behind its dedicated one:
> https://t.me/c/4415865297/41004

So the deliverable is one seat added, and cursor untouched. Nothing here moves,
wraps or replaces cursor anywhere.

## What shipped

| piece | file |
|---|---|
| the subject id, beside `CURSOR_REMOTE` and `BUBBLE` | `telegramCursorBridgeCore.ts` |
| the seat's decisions | `extension/src/tools/localQwenSeat.ts` |
| unit tests | `extension/test/bl1235LocalQwenSeat.test.js` (20) |
| the two invariants | `extension/test/bl1235LocalQwenSeatInvariants.property.test.js` (5) |
| acceptance handlers | `specs/pipeline/steps/bl1235LocalQwenSeatSteps.js` |

`QWEN_LOCAL` is a third entry in the topic map the same `topicForSubject`
already resolves — a sibling of what is there, not a new mechanism, which is
what the ticket asked for.

## The half of the directive that is easy to get wrong

"Cursor stays behind the usual host topic and front desk" is enforced in two
places that back each other up:

1. `decideLocalSeatTurn`'s FIRST clause returns `not-mine` for any topic that
   is not the seat's, before the endpoint, the model or anything else is
   considered. There is therefore no path on which the local seat answers on
   cursor's surfaces — including when its own endpoint is down, where a seat
   that helpfully said "I am broken" would still be *answering on cursor's
   topic*.
2. `QWEN_LOCAL` is deliberately NOT added to `CursorBridgeTopicScope`. The
   cursor bridge's `decideInboundGate` ignores anything outside that bag, so
   leaving the seat's topic out of it is what makes the other direction
   structural rather than a filter someone could forget.

Scenario 02 asserts both sides — the local seat says nothing, AND the surface
is still owned by the agent it was already bound to — because "the local seat
did not answer" and "somebody still did" are different claims and the directive
needs both.

## The model tag: answered, and still configuration

The ticket refused to guess a tag and left it open. The human answered directly
in the ticket's notes: **`qwen3:14b`**, chosen over the ticket's guessed
`qwen2.5-coder:14b` from the models actually pulled on this host.

That answer is the DEFAULT, not a hardcoding. `resolveLocalSeatModelId` takes
an explicit config value first, then `SWARMFORGE_LOCAL_SEAT_MODEL`, then the
default — and the seat still checks whatever it ends up with against the
endpoint's own catalogue at seat time, so a wrong tag is a visible refusal
naming what the endpoint *does* hold, never a silent fallback.

## The slow turn, from the human's own measurement

The notes record: no dedicated GPU, CPU-only inference, and a real turn
(2046-token prompt, 289-token reply) took **3m19s at ~2.8 tok/s**, with the
suggestion that the turn loop "account for that rather than assume a fast round
trip".

`formatLocalSeatAcknowledgement` is that: the seat says it has started, names
the model, and says a reply can take several minutes. Without a first word the
topic looks dead for minutes and the operator's reasonable conclusion — that
the seat is broken — would be wrong.

## The invariants (BL-654)

Invariant 1 is stated as an implication over every input the seat can be
handed: if the decision is `answer`, the message arrived in the seat's own
topic. That direction cannot be satisfied by a filter applied late — any path
that answers has to have come through the topic check.

Reach is by construction over the SURFACES that exist (cursor's host topic, the
front desk, the seat's own, an unrelated topic, and no topic at all), each
floored, plus a floor on cursor's two surfaces specifically. A uniform integer
draw would hit the two the directive names almost never.

Invariant 2 is three claims and gets three assertions per draw: never silent
(non-empty, not a bare status code), says why (the endpoint's OWN reason, not a
generic stand-in), and hands the turn to nobody. The last is also structural:
the decision type has no fallback, delegate or escalate case, so there is
nothing for a caller to route on — a property asserts every produced kind is
one of the three, and that all three are actually produced.

Every draw is a refusal by construction, its cause drawn from the four real
ones (endpoint down, endpoint unhealthy, model absent, no model configured).

**Non-vacuity, both by breaking the code and running:**

| break | result |
|---|---|
| the topic gate loosened to "some topic, any topic" | invariant 1 FAILS: "the seat took a turn on cursorHostTopic" |
| the refusal drops the endpoint's own reason | invariant 2 FAILS: "endpointDown lost its reason" |

Restored; 5/5 green.

## Runs

| what | result |
|---|---|
| BL-1235 acceptance | **5/5** |
| BL-1235 unit tests | 20/20 |
| BL-1235 property tests | 5/5 |
| standing collision guard | 6/6 |

`extension/test/telegramCursorBridgeCli.test.js` is 3 red — baselined against
HEAD with my change reverted, identical 3, and it is one of the 26 files in
this branch's standing red set. Not this parcel's.

## What is left, and is deliberately not a build

The live binding (`{"41004": "QWEN_LOCAL"}` in
`.swarmforge/operator/cursor-bridge-topic-map.json`) is runtime operator state —
the file is gitignored and does not exist in this worktree. The seat resolves
whatever the map says and the acceptance proves that resolution against the
map's real shape; writing the live file is an operational step on the host, in
the same class as `named-model.js pull|serve`, which the ticket also puts out
of scope as "an operational RUN, not a build".

Also untouched, per `out_of_scope`: cursor anywhere, installing ollama,
staffing pipeline roles with a local model, and renaming Telegram/Cursor
identifiers for interface purity — even though this is the genuine second host
incarnation local-engineering rule 7 names, which licenses the seat and
nothing else.

## Architect bounce, 2026-08-30 — D1 and D2, both correct

### D1 — the seat was unreachable

The architect's grep is the finding, and it is right: every export of
`localQwenSeat.ts` had exactly two referents, the module itself and the subject
id. Nothing in the live bot resolved the seat's topic, routed an inbound
message through `decideLocalSeatTurn`, or called the model. Posting in topic
41004 would have done nothing.

Worse, my own evidence file said the only remaining step was the operator
writing the topic-map binding. That was wrong and I should not have written it:
the ticket's own description commissions the turn loop — *"The turn loop then
sends the topic's message to the local endpoint and posts the completion back
into the same topic"* — and its qa_e2e step 2 asks someone to post a message and
see a reply. I built the decision, called the I/O "the caller's", and then
declared the caller out of scope by pointing at the one operational step that
genuinely was.

**The acceptance did not catch it because every scenario drives the decision
directly** — its own header says so. A decision function with zero callers reads
as fully tested. That is the general lesson here, not a detail of this ticket.

**Built:** `extension/src/tools/localQwenSeatLive.ts` — the seat's topic
resolved from the same map cursor's and Bubble's come from, the endpoint read
(`/api/tags`), the completion call (`/api/generate`, non-streaming), and one
whole turn: decide, acknowledge, complete, post back, with every edge injected
so it runs in-process with no ollama and no bot.

**Wired:** in `processInboundUpdates`, BEFORE `decideInboundAction` is consulted
— a message in the seat's topic is handled and the loop moves on, so cursor is
never asked about that topic at all. That placement is invariant 1's structural
half at the dispatch level, matching the one already in the decision.

**It runs inside the existing poll, deliberately, not as a second poller.** A
bot token has exactly one `getUpdates` consumer; a second one is an immediate
409 that would take the front desk down — a spectacular way to honour "cursor
stays behind the usual host topic".

Re-running the architect's own grep now returns four files: the two seat
modules, the subject-id declaration, and the live loop that calls them.

Order matters in the turn and is asserted: on `answer` the acknowledgement goes
out FIRST, because the measured turn on this host is 3m19s. A completion that
throws becomes a refusal carrying the endpoint's own words, posted in the same
topic. `not-mine` posts nothing at all.

One thing the tests found while writing them: a completion of pure whitespace
was being posted as a blank message, which in a topic is indistinguishable from
a broken seat. It is trimmed in the turn loop now, not only in the default
completion call, so any completion source gets the same treatment.

### D2 — my reach floor was a one-in-eight lottery

Also correct, and the arithmetic is exactly right: `P(answer) = 1/5 × 1/4 × 1/3
= 1/60`, and `(59/60)^120 ≈ 13%`.

This is the third property test in this repo to fail the same way, and twice
today I fixed the same shape in someone else's — so the fix is the one that
class always wants: **build the case, never raise `numRuns` until the lottery
usually wins.** Each of the three decision kinds now has its own constructed
input and its own `fc.assert`, so the floor cannot miss. The uniform-draw
breadth check is kept as a separate test with no floor on it, because breadth
is what it is for.

Run eight times back to back: 8 passes, 6 tests each.

### Runs after the bounce

| what | result |
|---|---|
| BL-1235 acceptance | 5/5 |
| unit (`bl1235LocalQwenSeat` + `bl1235LocalQwenSeatLive`) | 33/33 |
| property | 6/6, eight consecutive runs |
| `telegramCursorBridgeLive.test.js` (the file wired into) | 129 passed |

`telegramCursorBridgeCli.test.js` is 3 red — baselined against HEAD before this
parcel, identical 3, and one of the 26 files in this branch's standing red set.
