# Morning briefing request (coordinator note to documenter, 2026-09-05)

The human asked for a morning briefing email and none has gone out since
`docs/briefings/2026-09-03.md` — nothing exists for 2026-09-04 or
2026-09-05.

Root cause (separate from this request, already routed to specifier as a
process defect): the BL-658 closing-ceremony gate is currently stuck in
`mode: "ceremony"` with `consultFixedMorningTrigger: false`, and the
ceremony's own state for `nightKey: 2026-09-05` already reads
`phase: "done"` / `advanced: false` — it believes it finished without ever
sending a briefing, because it still assumes the old day/night schedule
where the swarm actually stops overnight; the new continuous 24/7 schedule
(installed 2026-09-05) never stops it. Until that's fixed, neither the
automated ceremony-driven briefing nor the fixed-morning-trigger fallback
will fire on their own.

**Ask: please compose today's morning briefing now**, same as the normal
`docs/briefings/<date>.md` format (see `2026-09-03.md` for the template —
theme-grouped narrative, ticket IDs and closure times read from
`backlog/done/` and `git log`, not recalled), covering the period since
`2026-09-03.md`'s cutoff (i.e. spans 2026-09-04 and 2026-09-05 to now).

Once the file exists at `docs/briefings/2026-09-05.md` on `main`, the
existing `briefing-email-sweep` (handoffd.bb, unconditional — not gated by
the stuck ceremony) will pick it up and send it automatically; no further
action needed from you beyond writing and landing it through the normal
pipeline.
