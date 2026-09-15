# BL-1578 — unowned red in `npm run test:properties` (unrelated to this parcel)

## Failing command
`npm run test:properties` (from `extension/`), full property-lane run.

## Commit
`916fb5d357` merged with documenter `07b38dd24e` → QA commit
`Merge documenter 07b38dd24e into QA.`, parcel task
`BL-1578-three-sampled-reach-floors-are-constructed`.

## Failure
`test/bl1295RevertAttributionInvariants.property.test.js` — `property
(invariant 2): a revert of the task's own merge never changes the verdict`:

```
AssertionError: generator never produced a genuinely foreign commit - the case that must still refuse
```

## Root cause (read, not fixed here)
Lines 179-208 of that file draw `fc.boolean()` uniformly for `numRuns: 6`
and then require BOTH `seen.clean > 0` AND `seen.genuinelyForeign > 0`
(lines 206-207) — the exact sampled-reach-floor-lottery shape BL-1062,
BL-1555, BL-1559, BL-1572, and this very ticket (BL-1578) exist to fix,
just not yet applied to this file. Missing one boolean value in 6 uniform
draws happens ~3.1% of the time (2 × 0.5⁶) — not constructed by iterating
both arms the way BL-1578's own three files now do.

This file is untouched by BL-1578's diff (`git diff main...HEAD
--name-only` on this parcel touches only
`extension/test/bl1529ScriptSenderAuditOutcomesInvariant.property.test.js`,
`extension/test/bl622TelegramTokenSeparationInvariant.property.test.js`,
`extension/test/meanTicketTimeCost.property.test.js`, the feature/step
files, `backlog/standing-reds.tsv`, and this ticket's own evidence files).

## Other property-lane results this run
407 of 408 files passed (1200 of 1201 tests). The three
`[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled errors are the
BL-871 allowlisted benign noise. All three of BL-1578's own files
(`bl1529ScriptSenderAuditOutcomesInvariant`, `meanTicketTimeCost`,
`bl622TelegramTokenSeparationInvariant`) passed in this same run, and each
was separately verified green 15/15 in isolation with its `BL-1578 reach
map` line printed at the exact value the ticket specified
(`{"cells":10,"minDrawsPerCell":2}`, `{"regimes":2,"minDrawsPerRegime":6}`,
`{"arms":2,"minDrawsPerArm":15}`).

## Failure class
`unit` (property lane) — sampled-generator reach-floor flakiness in a file
BL-1578 does not own, not a defect in this parcel's own diff.

## Grep for existing ownership (BL-1063)
`grep -irl "bl1295RevertAttributionInvariants" backlog/active backlog/paused`
returns nothing. `bb swarmforge/scripts/standing_red_register_cli.bb .`
lists only the two BL-1579-owned rows
(`bl1343ReplayNeverDropsOwnPathInvariants`, `bl1323StampOffInvariants`) —
`bl1295RevertAttributionInvariants` carries no row and no open ticket.
Genuinely unowned per Article 4.2.

## Expected vs observed
Expected: `npm run test:properties` green, or red only on an owned/registered
line. Observed: a genuinely unowned generator-reach-floor red in a file
BL-1578 never touched.

## Remediation pointer
Not this parcel's remediation — the specifier mints (or amends BL-1579's
shape onto) a ticket for `bl1295RevertAttributionInvariants.property.test.js`
invariant 2's boolean arm, iterating both arms by construction the way
BL-1578's own three fixes and BL-1579 do, never lowering the floor or
retrying.
