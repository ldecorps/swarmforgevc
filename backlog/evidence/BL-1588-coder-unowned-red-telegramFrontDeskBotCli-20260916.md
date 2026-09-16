# Unowned red found during BL-1588's re-verification (2026-09-16)

## Failing test
`extension/test/telegramFrontDeskBotCli.property.test.js > property
(BL-1203 invariant 2): the pointer file always holds the text of the last
genuinely-new-updateId capture, never a stale earlier one`

## Failure, verbatim
```
Error: Test timed out in 60000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/telegramFrontDeskBotCli.property.test.js:181:1
```

Its own explicit `60000ms` third argument on the `test(...)` call — the
same class BL-1592 already owns for `bl1529ScriptSenderAuditOutcomesInvariant`
("a per-test argument no lane-level ceiling reaches").

## Reproduction
One of five full-lane `npm run test:properties` runs during BL-1588's
post-fix re-verification (2026-09-16, run 1 of 5,
`backlog/evidence/BL-1588-coder-bounce-fix-20260916.md`). Did not
reproduce in runs 2-5, consistent with a load-dependent timeout, not a
deterministic red.

## Not this parcel's
BL-1588 is a property-lane per-test-timeout fix scoped to four named
files (`bl1308`/`bl1315`/`bl1343`/`bl1354`); `telegramFrontDeskBotCli` is
not one of them, and BL-1588's own constraints explicitly pin its
population to the named files, not grown by any run's evidence.
`backlog/standing-reds.tsv` and
`swarmforge/scripts/property_suite_standing_allowlist.tsv` carried no row
for this file as of 2026-09-16 (grepped clean, before this note).
Reported as an unowned-red note (priority 00) to the specifier and
coordinator per the standing-red rule.
