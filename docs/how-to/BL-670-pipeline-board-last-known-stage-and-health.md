# The Pipeline Board's Stage Status, As-Of Time, and Health Dot (BL-670)

## What changed

`.swarmforge/board/ticket-stage-map.json` (the BL-464 authoritative source
for the Telegram Pipeline Board and BL-659's completion ring) used to map
`{ticket-id -> role}` — a bare role string. It now maps to a qualified
entry:

```json
{"BL-604":{"stage":"hardender","status":"claimed","asOf":"2026-08-30T02:54:21Z","healthDot":"green"},
 "BL-1232":{"stage":"hardender","status":"in-transit-to","asOf":"...","healthDot":"green"},
 "BL-1194":{"stage":"coordinator","status":"last-known","asOf":"2026-08-27T18:05:20Z","healthDot":"green"},
 "BL-1182":{"stage":"QA","status":"claimed","asOf":"...","healthDot":"yellow"}}
```

Layout — grid columns, padding, epic captions, the mini-slug row — stays
entirely BL-585's per the human's 2026-08-19 ruling ("BL-670 = semantics +
health dots only"); this ticket changes only the DATA the board reads.

## The three statuses, and what each one means

- **`claimed`** — a role has the parcel `in_process` right now: today's
  derivation, unchanged.
- **`in-transit-to`** — a parcel is sitting in the next role's `new/` inbox,
  not yet claimed. This is BL-1048's "never not-started" case, now carrying
  its own explicit status word instead of being indistinguishable from
  `claimed`.
- **`last-known`** — nothing live (no `in_process`, no `new/`) mentions the
  ticket at all, so the durable `sent/` handoff trail answers instead: the
  role the ticket was last forwarded TO. A bare pre-BL-670 role string (a
  cache written before this shipped, or a fixture using the old shape) also
  reports as `last-known` — the honest reading of "we know where it was and
  nothing more."

Every entry also carries an **`asOf`** ISO-8601 UTC timestamp — ONE of the
declared invariants: a ticket any stage has touched always carries its
stage qualified with a status and an as-of; a bare role with no status and
no as-of is not a satisfied derivation.

## The trail is a fallback, not a competitor

The obvious design — rank the three statuses against each other, `claimed`
beats `in-transit-to` beats `last-known` — breaks a landed contract:
BL-1048's own scenario has a ticket delivered to the architect while still
technically open at the cleaner, and requires the LATER (more-downstream)
role to win, because more-downstream is more current. Status precedence
would let the upstream claim win.

So live observations reconcile exactly as they always did — role order,
most-downstream wins, BL-464 and BL-1048 untouched — and the `sent/` trail
is consulted **only** for a ticket no live mailbox mentions at all. Evidence
about where a ticket WAS can never outrank evidence about where it IS. This
also means a stale trail entry can never displace a live derivation, which
matters most during a bounce, where the trail's newest downstream entry is
the stalest thing about the ticket.

When two observations tie on the same role and the same status, the LATER
`asOf` wins (a string compare over ISO-8601 UTC, which sorts correctly) —
this closes an order-dependence a property test found: two same-role,
same-status observations differing only in `asOf` used to keep whichever
the directory listing happened to yield first.

`sent/` entries name the **recipient**, not the sender: a parcel in a
role's own inbox names that role, but a parcel in that role's SENT box
names the role it was sent TO — reading the mailbox owner there would park
every forwarded ticket back on whoever last touched it, the opposite of
last-known.

## The health dot

Per ticket, derived from the ticket YAML's own `bounce_history:` (the BL-635
recorder) — no new store: green for zero bounces, yellow for one or two,
red for three or more ("3 barely, 8 no way" — the bound speaking for
itself).

## One derivation, two consumers — and both mirrored-constant sides are tested

The board (`pipelineGridLive.ts`'s `invertTicketStageToRoleHeldTickets`) and
BL-659's completion ring read the SAME stage/status/asOf/healthDot from the
SAME durable map, so they can never disagree — a declared invariant. On the
Babashka side, `pipeline_stage_lib.bb` defines the three status literals and
the `health-dot-for-bounces` derivation; `pipeline_stage_cli.bb` scans
`:sent` alongside the existing `:new`/`:in_process` mailbox states.
`swarmState.ts` mirrors the same six literals (three statuses, three dot
colours) on the TypeScript side — per the engineering article's
mirrored-constant rule (BL-897), a test reads the literals out of the
Babashka source by regex and asserts the TypeScript constants equal them,
rather than trusting a comment to keep the two in sync.

`readTicketStageMap` and `invertTicketStageToRoleHeldTickets` accept EITHER
shape — several landed acceptance fixtures (BL-464, BL-487, BL-1188) still
write the pre-BL-670 bare-role shape directly, and a swarm whose cache
predates this ticket must not render a blank board.

## What this ticket does not touch

Sync triggers (BL-487 already made the concierge tick shell out to
`pipeline_stage_cli.bb report` on every tick — the coordinator-written
cache was never the source of truth even before this ticket, and that
posture is unchanged, so staleness is not what this ticket fixes); all
layout including the dropped mini-slug row (BL-585's, per the 2026-08-19
ruling); the per-ticket legend deep-links (BL-940); and the not-started
defect itself, which BL-1048 already shipped and whose own feature file
still owns it.

## Verifying

1. With a ticket genuinely in transit (its parcel sitting in the next
   role's `new/` inbox, nothing claimed), let the concierge tick repaint
   the Pipeline Board and confirm it shows the last-known stage with an
   in-transit marker and an as-of time — never not-started.
2. Read `.swarmforge/board/ticket-stage-map.json` directly, or run
   `pipeline_stage_cli.bb <root> report`, and confirm the richer
   `{stage, status, asOf, healthDot}` shape for that ticket.
3. Let a role claim the parcel and confirm the same ticket flips to
   `claimed` at that role on the next tick.
4. With every `in_process` and `new/` box empty, confirm a ticket already
   forwarded to a downstream role still shows that role at `last-known`,
   not not-started.
5. Confirm a ticket with 0 recorded bounces shows a green health dot, one
   with 1-2 shows yellow, and one with 3+ shows red.
6. Confirm BL-585's grid layout — columns, padding, epic captions — is
   unchanged by this parcel.

## Related

- [One unified pipeline grid across swarms](BL-1009-one-unified-pipeline-grid-across-swarms.md)
  — the caption/badge layer this ticket's data feeds, unchanged by it.
- [Pipeline Board: current-folder links](BL-513-pipeline-board-current-folder-links.md)
- [Seat identity never escapes the observation path either](BL-1040-seat-identity-never-escapes-on-the-observation-path.md)
  — a seat-qualified stage-map key now folds onto its bare stage before the
  precedence reconciliation this doc describes, closing a separate
  not-started false-negative for a multi-seat stage.

Acceptance: `specs/features/BL-670-pipeline-board-last-known-stage-and-health.feature`.
