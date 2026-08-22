# BL-896 — architect pass — 2026-08-16

## Scope reviewed

Parcel received from cleaner via `merge_and_process cleaner af64021129`.
First pass through architect (no prior `bounce_history` on the ticket).
Two commits in scope:

- `046d95fc1` (coder) — certifies the `14724edae7` hotfix: renames the
  chart's heading/note-line off "burndown" (F1), extracts the duplicated
  `isRemainingAtDayEnd`/`isRemainingOnDay` predicate into
  `gitHistoryAdapter.ts::isTicketRemainingAtDayEnd` (F2), reconciles today's
  open count against a live `active+paused+hold` disk read (F3), and
  extracts handoffd.bb's inline diagram-source concat into
  `briefing_email_lib.bb::diagram-section-from-sources` so the
  fail-open-independently claim is testable (F4). Adds property tests for
  both declared invariants and acceptance step handlers for the feature's
  scenarios.
- `af6402112` (cleaner) — splits the coder's new `notDoneBurndown.ts`
  (mutation-site-count.js flagged it at 181 sites, over the 100 threshold,
  mixing series derivation and SVG/PNG rendering) into `notDoneBurndown.ts`
  (66 sites) and `notDoneBurndownChart.ts` (115 sites), matching the
  existing `deliveryMetrics.ts`/`gitHistoryAdapter.ts` data/adapter split.
  No behavior change; call sites updated.

This is a hotfix-certification ticket (BL-848): commit `14724edae7` landed
on `main` pre-gate to clear BL-839 master-checkout drift; this parcel is
the gate, reviewing/fixing that landed diff rather than building new
product surface. The product decision (a not-done chart belongs on the
morning briefing) is locked per the ticket and not reopened here.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` (paths relative to
`extension/`, cwd = EXTENSION_ROOT) against every changed TS/JS file:

```
src/metrics/deliveryMetrics.ts
src/metrics/gitHistoryAdapter.ts
src/metrics/notDoneBurndown.ts
src/metrics/notDoneBurndownChart.ts
src/tools/render-briefing-burndown.ts
../specs/pipeline/steps/bl896BriefingOpenTicketChartSteps.js
```

**PASSED, no forbidden edges** on both invocations.

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against the full changed-file
set (TS + `.bb`). All "SUSPECTED COUPLING" flags are within this ticket's
own coherent slice: `notDoneBurndown.ts` <-> `notDoneBurndownChart.ts` <->
`render-briefing-burndown.ts` <-> their own test files (the F2 split, one
feature's own internal seams), and the pre-existing
`briefing_email_lib.bb` <-> `handoffd.bb` <-> `briefing_email_test_runner.bb`
hub coupling already established before this ticket (same pattern noted
benign in prior architect passes on this file trio). `deliveryMetrics.ts`
<-> `gitHistoryAdapter.ts` coupling is the F2 fix's own intended shape (the
shared predicate now lives in the adapter, both consumers depend on it). No
new/unexpected coupling.

## required_wiring (BL-874 lesson applied)

Checked as a literal substring in this merged worktree:
`swarmforge/scripts/handoffd.bb::briefing-burndown-json` — present
(`handoffd.bb:2201`, `defn briefing-burndown-json`), and its result still
reaches the briefing through `briefing-diagram-section` ->
`diagram-section-from-sources` -> `send-unsent-briefings!`'s
`:diagram-section` adapter (traced end to end by reading the diff, not
assumed).

## Invariants review (BL-654)

Ticket declares 2 invariants. Both carry a real, non-vacuous property test
— checked existence/non-vacuity BEFORE hand-verifying the property itself:

1. *"Every ticket count the briefing states matches the backlog's actual
   lane contents on the day it is stated."* Encoded in
   `extension/test/bl896BriefingOpenCountInvariants.property.test.js`
   (fast-check, `test:properties` lane only). Non-vacuous: the file's own
   header records the coder's break-then-fix check (removing the
   reconciliation block makes the property fail), and it additionally
   carries a `generator reach` test asserting the generator actually
   samples the lifecycle-open/disk-closed divergence F3 is about — not
   just a hope. Independently re-ran: `npm run test:properties -- <file>`,
   2/2 PASS.
2. *"No briefing chart source failing can suppress another source that
   succeeded, or the send itself."* Encoded in
   `swarmforge/scripts/test/bl896_briefing_diagram_source_independence_property_runner.bb`
   (hand-rolled seeded generator — Babashka has no test.check equivalent
   wired, BL-472 gap, same class as every other `.bb` property runner in
   this directory). Exhaustively covers all 4x4 throw/nil/empty/success
   combinations for the two sources, plus a `generator-reach` floor
   assertion for the exact (throw, success) divergent pair. Non-vacuous:
   header records the coder's break-then-fix check (removing the
   try/catch around either source thunk makes P1 fail with "itself
   threw"). Independently re-ran: `bb
   bl896_briefing_diagram_source_independence_property_runner.bb`, 500
   runs, ALL PASS.

Both properties are on pure/testable modules
(`computeNotDoneBurndownSeries`, `diagram-section-from-sources`) — the
correct place for them per the testable-module boundary.

## Correctness spot-check

Traced `computeNotDoneBurndownSeries`'s reconciliation by hand: only
`series[series.length - 1]` (today's point) is overwritten with
`currentOpenTicketIds.size` when the optional 4th arg is given; every
earlier day keeps the lifecycle-derived estimate. The function's own doc
comment states explicitly why historical points are NOT reconciled (past
disk state cannot be reconstructed) and that this is an adapter-level gap
shared by every `deriveTicketLifecycles` consumer — matching F3's explicit
instruction to say so rather than silently patch one caller. No defect.

Traced `diagram-section-from-sources`: each source thunk wrapped in its own
`try/catch -> nil`, independently, before concatenation — one source's
exception genuinely cannot affect the other's contribution or prevent
`build-diagram-section` from being called. No defect.

F1's heading rename verified on all three named surfaces: SVG title
(`notDoneBurndownChart.ts:96`, "Open tickets remaining — last N days"),
email `<h3>` (`briefing_email_lib.bb`'s `diagram-heading`, "Open tickets
remaining"), and the note-line (`diagram-note-line`). None read "burndown".

F2 duplication verified resolved, not just relocated:
`deliveryMetrics.ts` now imports and calls
`gitHistoryAdapter.ts::isTicketRemainingAtDayEnd` (line 101) — grepped for
`isRemainingOnDay`/a second inline definition, found none; one
implementation, two consumers.

## Independent verification (not just re-reading the commit messages)

Ran directly on this host, on this merged commit:

- `npx tsc --noEmit -p extension` — clean, no compile errors.
- `npx vitest run test/notDoneBurndown.test.js test/gitHistoryAdapter.test.js
  test/renderBriefingBurndownCli.test.js test/deliveryMetrics.test.js` —
  **67/67 PASS**.
- `npm run test:properties -- test/bl896BriefingOpenCountInvariants.property.test.js`
  — 2/2 PASS.
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/bl896_briefing_diagram_source_independence_property_runner.bb`
  — 500 runs, ALL PASS.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-896-briefing-not-done-burndown-stamp.feature` —
  **7/7 scenarios pass** (heading naming, live open-count match, 4x
  source-independence rows, empty-window degradation).

## Property testing pass (architect's own, beyond the ticket's declared invariants)

Both touched pure modules (`notDoneBurndownChart.ts`'s SVG/PNG builder,
`gitHistoryAdapter.ts`'s newly-extracted `isTicketRemainingAtDayEnd`) are
already exercised by the declared-invariant properties above plus dense
example-based unit coverage (67 unit tests across the touched files,
including PNG-magic-byte assertions on the renderer). No additional
undercovered property-shaped behavior found on the modules this batch
touched; not manufacturing a vacuous one.

## Verdict

Clean. All four minted findings (F1-F4) verified fixed, both declared
invariants verified with real non-vacuous property coverage, no
architecture violation, no correctness defect found. Forwarding to
hardener.

By architect.
