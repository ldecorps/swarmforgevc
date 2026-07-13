# INTAKE: A dedicated, persistent Operator topic on Telegram

**Raised by:** the human (ldecorps), 2026-07-13.
**Relayed via:** a Claude Code session working the swarm-recovery incident of
2026-07-13, at the human's explicit request ("file it") — the human had no
working access to the operator at the time of filing. This is a human-raised
item, not agent-generated scope; the relay is transport, not authorship.

## The ask (human's words, lightly expanded)

"Could the operator have its own Telegram topic so I can interact with it
there?"

One persistent, pinned forum topic that IS the Operator's home: the human
talks to the Operator there any time, without hunting for the right SUP-#
thread or waiting for one to exist. Today, conversation with the front-desk
operator is scattered across per-issue SUP threads and per-ticket BL topics;
there is no standing place where "the human wants to talk to the Operator"
is always possible and always attended.

## Desired behavior (shape, not spec — specifier owns the spec)

- A single dedicated topic (e.g. "Operator") that always exists; recreated
  if deleted, like other managed topics.
- Messages the human posts there reach the front-desk operator (BL-334's
  restricted operator) as a standing conversation thread — the per-thread
  transcript + long-term-memory plumbing from BL-281 looks like the seam.
- The Operator answers there by default for anything not tied to an existing
  SUP/BL thread.
- Nice-to-have, if cheap: the Operator posts its notable actions there
  (the one-line entries it already writes to operator.log), making the topic
  double as a live activity feed the human can reply to.

## Context worth honoring

- BL-334 (done) deliberately restricted the front-desk operator: it answers
  the human but cannot act on the swarm. Nothing here should widen that
  boundary — the dedicated topic talks to the RESTRICTED operator.
- BL-333/BL-345 own starvation alarms; this item is about reachability, not
  alarming.
- BL-341 (epics as first-class topics, paused) is adjacent topic-management
  work; the specifier may want to sequence or share machinery with it.

## Why now

During the 2026-07-13 incident the human's only reliable channel to the
system was screenshots into an external session. A standing Operator topic
is the everyday, phone-friendly front door that was missing.
