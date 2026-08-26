# Supervisor threads are not front-desk topics (BL-695)

## The gap

The concierge serialised every Telegram topic into git-tracked
`backlog/topics/*.json`, including the human's private supervisor (`SUP-*`)
threads. Commit messages like `BL topic record for SUP-12` looked like the
swarm reaching into a private conversation. Measured exposure: nine records,
each an id + icon marker with an empty message list — **no conversation text
in git**, but no boundary either.

## What changed

| Piece | Change |
| --- | --- |
| `topicThreadKind.ts` | Classify supervisor vs ticket vs unbound |
| `blTopicStore.ts` | Supervisor / unbound threads never write under `backlog/topics/` |
| Icon memory | Durable under `.swarmforge/` so exempt threads do not re-set icons every restart |
| Legacy | Nine `backlog/topics/SUP-*.json` records removed |

Ticket topics still commit exactly as before. Unrecognised kinds fail closed
(silence + report), never recorded as ordinary front-desk topics.

## Operator note

After restart, supervisor-thread icons should not flicker. Structural
isolation (separate Telegram group — BL-379/380/381) remains an open human
choice; this slice is the serialisation boundary only.

Acceptance:
`specs/features/BL-695-supervisor-threads-are-not-front-desk-topics.feature`
