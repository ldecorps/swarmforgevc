# QA bounce evidence — BL-1249-expeditor-restart-honours-the-operator-pause-marker (2026-08-29)

## Inventory (Article 4.4 — one bounce, complete pass)

Every gate QA owns was run to completion before this bounce; D1 is the only
item that failed.

| Gate | Result |
|---|---|
| Compile (`npm run compile`) | PASS |
| `npm run test:properties` — repo-wide | **D1 fails** (this ticket's own new file); rest is pre-existing standing red (see "Not bounced" below) |
| `swarmforge/scripts/test/expedite_lib_test_runner.bb` (unit coverage for `restart-hold-verdict`, Article 4.5) | PASS — `ALL PASS` |
| `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1249-expeditor-restart-honours-pause-marker.feature` | PASS — 8/8 scenarios |
| Full unit suite (`npm test` / `recordTestDuration.js`) | 38 files / 17 tests fail — pre-existing standing red, none touching BL-1249's files (see "Not bounced" below) |
| `required_wiring` (`expedite_cli.bb::control-pause`) | Confirmed wired — `read-restart-hold-marker-raw` is called from `restart-stack!`, which is invoked from the real run path (line ~766 of `expedite_cli.bb`), not only from the `--restart-only` diagnostic branch |
| Ticket-verdict-never-retracted invariant | Confirmed — `run-result`'s `:ticket`/`:ticket-ok?` fields are computed from `ticket` alone, unaffected by a `:held` restart outcome; acceptance scenario 04 and the bb unit tests both exercise this |
| Live host marker untouched | Confirmed — `.swarmforge/operator/control-pause.json` does not exist in this worktree; all fixtures used `mkdtemp` roots |
| Orphaned test/mutation processes | None before or after this pass |

## D1

1. **Failing command**: `cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1249RestartHoldNeverRendersLikeNoRestart.property.test.js` (reproduces identically inside the full `npm run test:properties` run)
2. **Commit hash**: `5b74276361` (QA worktree HEAD — QA's merge of documenter `cca6eb099c` for this ticket)
3. **First error excerpt**:
   ```
   RUN  v3.2.6 /home/carillon/swarmforgevc/.worktrees/QA/extension

   TAP version 13
   # Subtest: BL-1249/BL-654 invariant 1: a held restart report never matches a --no-restart report
   ok 1 - BL-1249/BL-654 invariant 1: a held restart report never matches a --no-restart report
     ---
     duration_ms: 3749.322727
     type: 'test'
     ...

   ⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

    FAIL  test/bl1249RestartHoldNeverRendersLikeNoRestart.property.test.js [ test/bl1249RestartHoldNeverRendersLikeNoRestart.property.test.js ]
   Error: No test suite found in file /home/carillon/swarmforgevc/.worktrees/QA/extension/test/bl1249RestartHoldNeverRendersLikeNoRestart.property.test.js

    Test Files  1 failed (1)
         Tests  no tests
   ```
4. **Failure class**: `unit` (property-test lane; the file is the coder-authored BL-654 invariant-1 property test the ticket's own `invariants:` field requires)
5. **Expected vs observed**: Expected — `npm run test:properties` collects and runs `BL-1249/BL-654 invariant 1: a held restart report never matches a --no-restart report` as part of the live suite. Observed — Vitest's collector registers **zero** tests from the file and reports the suite itself as failed; the assertion body only ran because `node:test`'s own runner executed it as a side effect of the `require()` call (hence the stray `TAP`/`ok 1` lines), never because Vitest counted it.

**Root cause**: `extension/test/bl1249RestartHoldNeverRendersLikeNoRestart.property.test.js:30` does
`const { test } = require('node:test');` and calls that `test()` directly.
`vitest.properties.config.mjs` sets `globals: true`, and every other passing
property test in this lane (e.g. `test/bl1008BoundedWatchDeadline.property.test.js`)
calls the **global** `test` with no import at all. Explicitly requiring
`node:test` shadows Vitest's global and registers the test with Node's own
test runner instead of Vitest's collector, so Vitest sees the file as empty.

**This is the same failure shape the specifier already dispositioned as
BL-1206/BL-1220/BL-1221** ("assertions counted as coverage that have never
run") — 15 pre-existing property files share the identical
`require('node:test')` anti-pattern — but BL-1249's file is new, written by
this ticket's own coder stage, so it is this ticket's own defect and does not
qualify for the BL-1063 "presumed already ticketed" carve-out (that carve-out
is explicitly scoped to reds "your own diff did not touch").

**Remediation pointer**: `extension/test/bl1249RestartHoldNeverRendersLikeNoRestart.property.test.js`,
remove the `const { test } = require('node:test');` import (line 30) and call
the ambient global `test` instead, matching every passing file in
`test/*.property.test.js` (e.g. `bl1008BoundedWatchDeadline.property.test.js`).
No other file needs a change — this file's assertion content is correct and
was verified to pass once Vitest actually collects it (confirmed via the
`node:test`-runner TAP output above, and via the file's own
`--restart-only`-driven logic already proven equivalent by the acceptance
scenarios).

**Owning role**: `coder` — BL-1249's commit message attributes this file to
"a coder-authored BL-654 property test," and the defect is purely in how the
test is wired to its runner, not in the property/invariant logic itself, the
architecture, hardening, or docs.

## Not bounced — pre-existing, confirmed untouched by this ticket

Grepped `backlog/{active,paused,done,evidence}` before writing this file
(BL-1063). Both standing reds below are already dispositioned by the
specifier in `backlog/evidence/specifier-disposition-qa-standing-red-note-20260828.md`
(and its 2026-08-28 addendum, `backlog/evidence/QA-standing-red-corroboration-20260828.md`),
tracked as BL-1220 (unit lane), BL-1221 (pilot-gate deps stub), BL-1206
(property lane, amended `medium`→`high` in that same note), BL-1247 (the
`bl593MutationRunTelemetry` flake, already QA-bounced separately per this
QA worktree's own recent history), and "assorted repo-hygiene guard reds"
(`constitutionDocCitations`, `tmpDirMigrationGuard`, `tempDirTrapGuard`,
`socketFixtureShortRootGuard`, `liveRepoDerivationGuard`) — all explicitly
named in that note as "left with their diagnosed owners," not swept into a
ticket.

- **Full unit suite**: `Test Files 38 failed | 530 passed (568)`, `Tests 17
  failed | 9309 passed (9326)` — file-for-file the same 38-file count the
  2026-08-28 addendum recorded for the unit lane. None of the 38 failing
  files are among the files this ticket's commits touch (`expedite_cli.bb`,
  `expedite_lib.bb`, the BL-1249 step-handler/property files); confirmed by
  diffing the failing-file list against `git show --stat` for every BL-1249
  commit.
- **Property lane, remaining ~18 failing files** (all `require('node:test')`
  or a sibling pattern, per the specifier's note): same list modulo BL-1249's
  own new file (D1 above) and whatever BL-1247 already resolved. None are
  files this ticket touches.

## Sibling scope

This bounce commit carries only BL-1249 work — no batch/multi-ticket commit
this pass, so no `qa-sibling-check.js defer` entries apply.
