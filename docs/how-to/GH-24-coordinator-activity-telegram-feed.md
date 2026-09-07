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

## First-run seeding, per-tick cap, and deadline (BL-1454)

`tick!` (`coordinator_activity_feed_lib.bb`) never walks the whole trace
history in one pass:

- **First run (no cursor file yet)**: the tick seeds both cursors at the
  newest existing sent handoff and the newest existing bookkeeping commit
  and posts nothing. The feed is a live log from the moment it starts, not
  a backfill — the 6000+ handoffs and commits already on disk when the
  feed is first enabled are never posted.
- **Per-tick cap**: a tick posts at most `activity-feed-post-cap` lines
  (env `ACTIVITY_FEED_TICK_POST_CAP`, default 20), oldest-first, with no
  duplicates; anything past the cap carries to the next tick.
- **Per-tick deadline**: a tick stops at `activity-feed-tick-deadline-ms`
  (env `ACTIVITY_FEED_TICK_DEADLINE_MS`, default 30000), clamped to at
  most one quarter of `SUPERVISOR_IN_SWEEP_BUDGET_MS` (the same budget
  `handoffd_supervisor.bb` enforces) — an override can only make the tick
  more conservative, never large enough to risk a `stalled` verdict.
- **Cursor durability**: the cursor is written after every successful
  post, not only when the loop ends, so a tick killed mid-batch re-posts
  nothing on restart.
- Listing is cheap: handoff file names are filtered against the cursor
  before any file is opened, so a tick's I/O scales with new traces only,
  never with the total size of `coordinator/sent/`.

The feed itself stays config-gated, default OFF
(`config coordinator_activity_feed_enabled true` to enable; absent means
OFF). Before BL-1454, enabling it against an absent cursor file would walk
every historical trace in one unbounded tick and reliably overrun the
daemon's sweep budget, tripping a `stalled` verdict and a full swarm halt.

Acceptance: `specs/features/BL-1454-the-activity-feed-sweep-fits-the-supervisor-budget.feature`.
