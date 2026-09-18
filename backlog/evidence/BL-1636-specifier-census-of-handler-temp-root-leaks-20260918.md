# BL-1636 - specifier census of handler temp-root leaks, 2026-09-18

Inbound: cleaner note 10_20260918T140816Z_000857 (priority 10): "5th
mkdtemp-leak-in-handler this session (BL-831) - census gate?". Accepted
as a process ticket.

## The five, this session (cleaner evidence, cleaner branch fca2da2a9f)

bl1624StandingShellTestNeverDiffsAgainstMainSteps.js,
bl1626PromotionFixturesCarryTheClosureSteps.js,
bl1632Bl1071ProbeCountsOnlyItsOwnFixturesHangsSteps.js,
bl693DocsDuplicateParagraphGuardSteps.js, bl831BubblePipelineBoardPageSteps.js
- each a `fs.mkdtempSync` root with no `finally`, no reaper registration,
no sweep; each fixed in a review round with `fixtureReaper.js`'s
`onAbnormalExit` pattern (BL-831-bounce-cleaner-20260918.md,
BL-693-bounce-cleaner-20260918.md).

## Census of the handler tree (node walk, main 858f8fca6c)

| measure | count |
|---|---|
| `*Steps.js` under specs/pipeline/steps | 1191 |
| call `fs.mkdtempSync` | 583 |
| of those: no `rmSync`/`rm(` anywhere in the file | 295 |
| of those: removal but no `finally`, no reaper, no sweep helper | 160 |
| of those: use a sweep helper (`sweepStaleFixtures` etc.) | 36 |
| require `fixtureReaper` | 31 |

Offenders by the ticket's definition: 455 (295 + 160). Script: for each
file, regex for `mkdtempSync(`, `rmSync(|rm(|rmdirSync(`, `finally {`, and
the helper names; kept in this file's history for re-running.

## The host (os.tmpdir() = /tmp), 2026-09-18 15:0x local

| measure | value |
|---|---|
| entries in /tmp | 695,941 (695,221 ten minutes earlier) |
| entries beginning with `bl` | 686,946 |
| `bl*` younger than 24 h | 48,243 (the daily rate) |
| oldest entry | 2026-08-27 (the re-seed) |
| `du -sh /tmp` | did not finish in 60 s |
| one `fs.readdirSync(os.tmpdir())` | 2,644 ms |
| code paths that list os.tmpdir() | 35 (tmpDir.js, blindTmpDirSweepFinder.js, three libs under specs/pipeline/steps/lib, the handlers' sweepStaleFixtures copies) |

Other prefixes (sfvc-unit-lane-budget- 1,795; sfvc-recruiter-battery 745;
sfvc-launch 743; tmp. 540; sfvc-benchmark 292; sf-safe-prop 203 ...) are
under 10,000 together and are other tools' business (out of scope).

## What exists and what does not

- Rule: engineering.prompt "Test Speed And Isolation" (finally + prefix
  sweep, BL-971; reap only roots no live run owns, BL-1385/BL-1390/BL-1623).
- Primitive: `specs/pipeline/steps/lib/fixtureReaper.js` (BL-458):
  `track`, `reap`, `onAbnormalExit`; handlers already use it for process
  trees.
- Gate for extension/test: `extension/test/tmpDirMigrationGuard.test.js`
  (BL-420) pins zero raw mkdtemp call sites there and has held.
- Gate for specs/pipeline/steps: none. Runtime cleanup hook: none
  (`specs/pipeline/runtime.js` has no afterEach; the bl1071 fixture header
  says so).
- BL-1623's sweep keeps a root with no pid in its name ("the pre-fix name
  shape survives"), so the existing sweep cannot reap the legacy backlog;
  an age floor is the only safe key for it.

## Decision

Mint BL-1636 (defect, high, auto-approved): a unit-lane guard over the
handler tree with a committed, shrink-only census of today's 455; a
one-line `trackedTmpRoot` helper in the reaper; an age-floored reap script
that keeps young roots and live-pid roots; the host-wide reap as QA's e2e
with no lane alive. Cross-links: BL-1630 (its 1.1 s per module-load sweep
is this listing), BL-1621/BL-1632 (property-lane fixture sweeps under
contention), BL-1618 (the human's "tests run for hours").

By specifier.
