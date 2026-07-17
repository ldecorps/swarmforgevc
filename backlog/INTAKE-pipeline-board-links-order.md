# Intake: pipeline board's LINKS section lists oldest ticket first — should be most-recent first

Filed by the coordinator (2026-07-17), relaying a follow-up correction the human
made directly (a screenshot of the live Telegram board's `LINKS:` section,
starting `BL-001: backlog/done/BL-001-dead-code-removal-dogfood.yaml`,
`BL-002: ...`, `BL-003: ...` in ascending order) after an earlier exchange about
the `RECENTLY CLOSED` list's own ordering (already correct — durable
`doneClosedAtMs`-based, most-recent-first, unrelated to this section).

This is a RAW ask, not a spec: the specifier drains this like any other
backlog-root item and decides what (if anything) becomes a real ticket.

## What the human asked (verbatim intent)

"my bad: it's the ordering of the yaml links that has to go from most recent"
— the `LINKS:` section (not `RECENTLY CLOSED`) should list most-recent tickets
first, not oldest-first.

## Coordinator context (not a decision — specifier owns the call)

`extension/src/concierge/pipelineBoard.ts`, `buildLinks` (~line 357-364):

```ts
const links = [
  ...linksFromRows(rows, ticketMeta),
  ...linksFromParked(parked, ticketMeta),
  ...linksFromRecentlyClosed(extras),
  ...linksFromRootIntake(extras),
];
links.sort((a, b) => a.id.localeCompare(b.id));
```

This is a single flat sort by ticket id STRING ascending across all four
sources (active rows, parked, recently-closed, root intake) — the visible
symptom is exactly what the human's screenshot shows: `BL-001`, `BL-002`,
`BL-003`, `BL-004`, ... at the top, oldest first.

Reversing the comparator (`b.id.localeCompare(a.id)`) is the mechanical fix,
but the specifier should confirm a few things before scoping it as trivial:

1. **Id format is currently safe for string sort either direction** — every
   id checked across `backlog/{active,paused,done}` today is a fixed 3-digit
   `BL-NNN`/`GH-NNN` (grep-verified 2026-07-17), so ascending or descending
   `localeCompare` both happen to equal numeric order. That breaks the
   moment any id rolls over to 4 digits (`BL-1000`), or if a `GH-` id and a
   `BL-` id need interleaving by true recency — a numeric-aware comparator
   (parse the trailing digits, compare as numbers, prefix as tiebreak) is the
   more durable fix and would not need revisiting at the four-digit
   boundary. Worth deciding now rather than filing a second ticket then.
2. **"Most recent" is ambiguous across the four merged sources** —
   `linksFromRecentlyClosed`/root-intake entries have no inherent "recency"
   beyond the id number itself (unlike `RECENTLY CLOSED`'s own
   `doneClosedAtMs`), so id-descending is the only recency signal actually
   available here without plumbing more data through `PipelineBoardLinkEntry`
   (which today only carries `{ id, path }`). Confirm id-descending is
   sufficient for what the human wants, rather than true chronological
   (closed-at/created-at) order.
3. **No other consumer relies on the current ascending order** — check
   `extension/test` for any fixture asserting the LINKS section's order
   before flipping it, so the fix doesn't just move the defect into a
   stale test expectation.

## Ask for the swarm

Specifier: spec a fix so the `LINKS:` section lists ticket links most-recent
(highest id) first — decide id-descending (`b.id.localeCompare(a.id)` or a
numeric-aware equivalent per point 1 above) is the right scope, or ask the
human to confirm if true chronological order across categories is actually
wanted instead.
