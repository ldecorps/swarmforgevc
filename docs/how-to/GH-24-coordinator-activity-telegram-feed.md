# Coordinator activity Telegram feed (GH-24)

A live, reasonably complete log of what the coordinator is doing, readable
on the phone in Telegram — one compact line per coordinator action, posted
to the coordinator's own standing topic shortly after the action happens.

## Deterministic, zero coordinator tokens

The feed is DERIVED from the coordinator's already-durable traces; the
coordinator LLM is never asked to narrate itself:

- **Handoffs it sends** — its outbox files under
  `.swarmforge/handoffs/outbox/`, read for type, recipient, task/message,
  and the audit-header timestamp.
- **Backlog bookkeeping** — its commits on `main` (ticket close/move to
  `done/`, promotions into `active/`), read by walking `git log` back to a
  cursor commit.

Two independent cursors, one per trace source
(`coordinator_activity_feed_lib.bb`'s `read-cursor!`/`write-cursor!`), each
advancing only past what the feed actually posted — a failed send stops
the tick immediately so neither cursor moves past an unposted trace, and a
cursor sha no longer found in the commit history (a rewritten branch) is
treated as "nothing new" rather than replaying the whole log.

## Cadence and posting

`handoffd.bb`'s `coordinator-activity-feed-sweep!` runs on the daemon's
existing sweep cadence (no new daemon) and shells out to
`coordinator_activity_feed_post.bb <project-root> <text>` — a small,
standalone CLI so the send goes through the daemon's one bounded-subprocess
chokepoint rather than an HTTP call inside the long-running process. It
posts to the coordinator's own topic id
(`.swarmforge/operator/role-topic-map.json`, the same standing-topic
infrastructure every other role's topic uses — never a second mapping),
honoring 429 `retry_after` with an UNBOUNDED retry — mirroring
`retryOnRateLimit`'s own reasoning (BL-342): giving up is exactly the
failure this contract exists to close, so a 429 is waited out and retried
for as long as Telegram keeps returning one, relying only on the daemon's
own 60s subprocess timeout as the outer safety net, never a retry-count
cap. A genuine, non-429 failure is reported immediately and never retried
within the same tick. An idle tick posts nothing; a send failure retries
next tick without duplication.

## Scope

Coordinator only — not other roles' activity, and not `handoffd`/daemon
sweeps and chases themselves (those are the daemon's acts, not the
coordinator's). Telegram group separation across multiple swarms is a
known, separate gap, untouched here.

Acceptance: `specs/features/GH-24-coordinator-activity-telegram-feed.feature`.
