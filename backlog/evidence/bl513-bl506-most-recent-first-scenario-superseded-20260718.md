# BL-513 landed: BL-506's own "most recent first" scenario is now stale

BL-513 (pipeline board LINKS: link every shown ticket, alphabetically, to its
current folder) replaces BL-506's `compareLinksMostRecentFirst` (highest
ticket number first, numeric-aware) with a plain ascending
`a.id.localeCompare(b.id)` sort, per the human's own follow-up directive
2026-07-18 ("current folder, all shown links" plus the original "alphabetical
order" ask). The coder flagged this in the BL-513 commit message but could
not retire the feature file itself (Gherkin scenario retirement is the
specifier's lane, not the coder's or architect's, per the established
BL-470/BL-475 precedent).

Confirmed empirically against the live compiled code (`npm run compile` +
`specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-506-pipeline-board-links-most-recent-first.feature`):

```
not ok 1 - links are listed highest ticket number first
  error: 'Scenario "links are listed highest ticket number first" failed at
  step "Then the links appear in the order "BL-504", "BL-493", "BL-101"":
  expected links in order ["BL-504","BL-493","BL-101"], got
  ["BL-101","BL-493","BL-504"]'
```

Only **scenario 01** ("links are listed highest ticket number first") is
broken by this — its own premise (descending-by-number) directly contradicts
BL-513's ascending-alphabetical contract. Scenarios 02 and 03 both still pass
by coincidence: the four-digit-vs-three-digit case ("BL-1000" before
"BL-999") and the unnumbered-id-sorts-last case both happen to produce the
same order under either comparator, so they are not reliable regression
coverage for the retired behavior — retiring scenario 01 alone leaves them
looking green without actually re-validating anything BL-506-specific.

This mirrors the BL-462-vs-BL-465 precedent
(`backlog/evidence/bl465-bl462-grid-slug-scenario-superseded-20260717.md`,
followed by ticket BL-475): a later, human-approved refinement supersedes an
earlier ticket's own scenario. Recommend a small follow-up ticket (mirroring
BL-475) that retires `specs/features/BL-506-pipeline-board-links-most-recent-first.feature`
scenario 01 and its now-dead step handler in
`specs/pipeline/steps/bl506PipelineBoardLinksMostRecentFirstSteps.js`
(`compareLinksMostRecentFirst`'s own production code and unit/property tests
were already removed by the cleaner as dead code in this same parcel).
Scenarios 02/03 can stay if their step text is re-pinned as ordinary
alphabetical-order coverage, or retire alongside 01 if the specifier judges
them redundant with BL-513's own scenario 02.

Every other check on this parcel is green: BL-513's own 9/9 acceptance
scenarios pass, the full unit suite (5446 tests) and property suite (24
tests, including a new non-vacuous ordering property added this review) both
pass, and the dependency-rule gate passes clean.
