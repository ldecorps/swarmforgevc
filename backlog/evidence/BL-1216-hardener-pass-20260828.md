# BL-1216 hardener pass — 2026-08-28

Merged architect handoff `150b836470` (BL-1216: DUPLICATE-ID finding names
the live copy and flags content divergence; architect bounce D1 re-fix —
property tests for all three declared invariants).

## Received state
- `backlog_hygiene_lib_test_runner.bb`: ALL PASS (28 assertions, including
  the 13 BL-1216-specific ones for `path-pool`/`pool-classification`/
  `content-verdict`/duplicate-id `format-violation`).
- `backlog_hygiene_lib_property_runner.bb`: ALL PROPERTIES HOLD (300 runs
  each, including the two new BL-1216 properties: P2 for invariant 1 — every
  path in a finding carries its own pool/classification suffix — and P3 for
  invariant 2 — content-verdict's identical-iff-every-path-matches
  semantics).
- Acceptance feature: 8/8 green at receipt.

## Fixture leak fixed
`bl1216DuplicateIdLiveCopyContentVerdictSteps.js`'s `an empty backlog corpus`
Background step created TWO fixture roots (`bl1216-backlog-*` and
`bl1216-published-*`) via `fs.mkdtempSync` with no cleanup anywhere in the
file — the same BL-529/BL-971 pattern found and fixed in BL-1228's and
BL-1230's step files earlier today. Confirmed: dozens of pre-existing leaked
dirs of both prefixes already in `/tmp` before this pass. Fixed with the
standing `registerFixtureRoot` + `process.on('exit')` + eager-Background-
removal pattern, additionally restoring any still-`chmod`'d-unreadable
fixture file's permissions before removal (the step file already restored
permissions after each gate run in the happy path; this closes the gap for
a scenario that throws before that step runs). Cleared the pre-existing
leaked dirs and re-ran: 8/8 green, 0 leaked dirs.

## Mutation / CRAP
No `extension/src/**` or `extension/out/**` file changed by this ticket —
the implementation lives entirely in `swarmforge/scripts/backlog_hygiene_lib.bb`
(Babashka, no wired mutation/CRAP tool per the Startup Tools rule) and its
test/property runners, which are gated by their own unit + property suites
only. Nothing to run for Stryker/CRAP/DRY.

## Cleanup
No orphaned test/mutation processes.

By hardener.
