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

## Update: epic/standing/role icon markers were silently dropped, now fixed (BL-1210)

This ticket's own classification split had a gap for two days
(2026-08-25–27): `recordSwarmIconId` only had a store for `ticket` and
`supervisor` kinds. Epic, standing and role ids classify `unbound` under
`topicThreadKind.ts` — correct for the tracked-record boundary above — but
`unbound` had no icon-marker store either, so a marker write for any of
those three kinds silently wrote nothing while `syncTopicIcon` still
reported `updated`. The tracked-record boundary itself was never affected
(none of the three could ever write under `backlog/topics/` either way);
what broke was the ownership marker that gates whether a later resync may
touch an icon it already set.

Fixed by giving epic/standing/role ids their own untracked store,
`.swarmforge/topic-icons.json`, alongside supervisor's existing
`.swarmforge/supervisor-topic-icons.json` — two files, so supervisor's
already-referenced filename is undisturbed. `recordSwarmIconId` now returns
`'recorded' | 'refused'` explicitly instead of writing silently and
optionally logging to stderr; `syncTopicIcon` reports the new
`'icon-set-marker-unrecorded'` outcome when a marker write doesn't return
`'recorded'`, rather than claiming `'updated'`. A blank id is `refused`
outright — no store may key a marker by an empty string. See the BL-1210
entry in `docs/reference/Specification.MD` for the full changelog.

## Operator note

After restart, supervisor-thread icons should not flicker. Structural
isolation (separate Telegram group — BL-379/380/381) remains an open human
choice; this slice is the serialisation boundary only.

Acceptance:
`specs/features/BL-695-supervisor-threads-are-not-front-desk-topics.feature`
