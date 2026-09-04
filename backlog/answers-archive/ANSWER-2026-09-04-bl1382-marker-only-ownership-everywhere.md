# ANSWER — 2026-09-04: BL-1382 ruling = option 1, marker-only ownership everywhere

Question (BL-1382 `ruling_options`, relayed by the Operator into front-desk
thread SUP-17 at 2026-09-04T14:10:18Z, after the human asked "can you approve
the 3 tickets for me" and the Operator answered that BL-1382 needs a policy
ruling as well as its approval): when a crontab line names
`<root>/.swarmforge/operator/` but carries no swarmforge marker, what should
the swarm's cron writers do? Options 1-3 as on the ticket.

Answer, verbatim, channel `telegram`, `2026-09-04T14:13:07.473Z`:

    Marker-only ownership everywhere (recommended) - stop, install and reconcile touch only marked lines; unmarked lines reported and left

That is the option 1 label. Verified by the specifier in
`.swarmforge/support/threads/SUP-17.json`. Recorded into BL-1382's
`human_ruling:` with this provenance (the BL-1375 precedent for a ruling
given outside the ruling keyboard). `human_approval` left `pending` for the
human's own tap.

The specifier had separately recommended option 1 in its own pane at
~14:1xZ when the human asked "what do you suggest we do?"; the human's
reply in SUP-17 is the ruling, that recommendation is not.

By specifier.
