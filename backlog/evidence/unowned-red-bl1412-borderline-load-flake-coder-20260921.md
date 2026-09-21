# coder pass — unowned red, bl1412SpecTreeTextFilterSteps.js borderline flake, 2026-09-21

While verifying BL-1681 (unrelated: retires two BL-696 scenarios,
touches neither this file nor its feature), `stepHandlerModuleLoadBudget.test.js`
repeatedly named `bl1412SpecTreeTextFilterSteps.js` over the 400ms
per-handler budget, confirmed alone, across several independent runs
today:

- 413.9ms (earlier this shift, load ~16-17)
- 628.2ms, 624.4ms (load ~17-18)
- 768.5ms (load ~17-18, full-lane run)
- 500.8ms (full-lane run, load moderate)
- 431.5ms (standalone, load 14.15 - lowest observed today)

Also measured genuinely under budget in isolation earlier today
(290-300ms at load ~13). This file is explicitly named in BL-1658's own
`out_of_scope`: "Any handler that requires jsdom lazily already (bl1046,
bl1160, bl1153, bl1412)" - it already moved its jsdom require inside the
step, unlike the files BL-1658/BL-1630 actually fix, but its own
incremental cost sits close enough to the 400ms budget that ordinary
swarm-host contention pushes it over on a large minority of
measurements, never staying comfortably clear the way the fourteen
handlers this session's own fixes moved to ~1-40ms.

## Search for an existing owner

Grepped `backlog/standing-reds.tsv` for `1412` - no row. Grepped
`backlog/active`, `backlog/paused` for `bl1412` - nothing open owns this
file's timing.

## Disposition

Filing as an `unowned-red` `note` (priority 00) to specifier and
coordinator per the standing-red rule (2026-09-05) - recorded now
because it has recurred enough times today (six separate observations,
five of the six over budget) to be a real pattern rather than a single
unlucky sample, not because any parcel today edits this file. Continuing
BL-1681's own work.

By coder.
