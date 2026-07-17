# Intake: Operator Telegram response latency / no immediate acknowledgment

Filed by the coordinator (2026-07-17), following up on a live incident the human
reported directly: a message sent in the Concierge/Operator Telegram topic
("if I wanted to pause the swarm from telegram, how would I do that?") appeared
unanswered for an extended period. Investigation found the Operator DID receive
and answer it (2 minutes after send, per `operator.log`), but by the time the
human checked back, the Operator had already moved on to answering a LATER
message in the same thread — so from the human's side it reads as "it answered
an older message" and "the feedback loop seems very large."

This is a RAW ask, not a spec: the specifier drains this like any other
backlog-root item and decides what (if anything) becomes a real ticket.

## What the human experienced

Sent a question in the Concierge topic, saw no reply for an extended window,
then later found the Operator had answered — but a different, subsequent
question, not the one being waited on. Net effect: the conversation feels
asynchronous/batchy rather than responsive, even though every message does
eventually get answered.

## Coordinator findings (context, not a decision)

1. The Operator is not a resident process — `operator_runtime.bb` spins up a
   fresh Claude invocation per event/tick (default `OPERATOR_INTERVAL_MS` =
   30000ms), and each invocation does a full health sweep (tmux windows,
   handoffd heartbeat, backlog counts, memory, orphan processes) in addition
   to composing the actual reply. That bundled overhead means a genuine reply
   can take a couple of minutes end-to-end even when nothing is wrong.
2. If the human sends a second message before the first invocation's reply
   has posted, the Operator processes them in arrival order, one invocation
   at a time — there is no immediate "got it, working on it" acknowledgment
   between send and the real answer, so a human watching the chat has no
   signal that the message was received until the full answer eventually
   lands, possibly several minutes and one more question later.
3. This is a genuine, reproducible UX gap, not a malfunction: every message
   in the observed window WAS answered (verified via `operator.log` +
   `telegram-reply-outbox.jsonl` + the persisted relay ack cursor), just with
   real latency and no interim acknowledgment.

## Ask for the swarm

Specifier: scope whether/how to close this gap. Options worth considering
(not a prescribed design):
  - A fast, cheap immediate ack reply ("got it, looking into this...") posted
    the moment a message is recognized as addressed to the Operator, before
    the full reasoning pass completes — decouples "received" from "answered"
    the way most chat-bot UX handles multi-second-to-minute processing.
  - Shortening `OPERATOR_INTERVAL_MS` or triggering an out-of-cycle tick
    specifically on a fresh inbound Telegram message, rather than waiting for
    the next scheduled sweep.
  - Simply documenting the expected latency somewhere the human can see it
    (a pinned note, a "usually replies within N minutes" line), if a
    lower-cost fix isn't warranted.
Human approval needed before any of this is built — this is a live-process
UX change, not a mechanical fix.
