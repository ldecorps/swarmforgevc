# BL-886 hardener pass — swarm-stamp vitest orphan-reaper hotfix

**Ticket:** BL-886 — swarm review-stamp-off of the human-landed Cursor hotfix.
Review-only parcel (no production `.bb`/`.js` file under review modified by
coder or architect — confirmed independently, see below). **Reviewed
commit:** `a2d8f206a8` (architect pass, architecturally compliant, forwarding
to hardener). **Role:** hardener.

## Scope confirmation

`git show fc6ead5f0 --name-only` (the coder's actual diff) touches only test/
step-handler/fixture-helper/evidence/ledger files — no `extension/src/*.ts`,
no `.bb` production file. Matches both the coder's and architect's own claims.
Consequence: CRAP (scoped to `src/*.ts`) and DRY (`jscpd --config .jscpd.json
src`, `**/*.ts` only) are genuinely not applicable to this parcel — not a
degraded fallback, there is simply no production TS in the diff to run either
tool against. The `.bb` half has no mutation/CRAP/DRY wired per
engineering.prompt (already recorded by the coder).

## Pre-run hygiene

- `pgrep -fl 'node --test|stryker'` (scoped) — none running before start.
- `pgrep -afl tmux` — only the two legitimate swarm sockets
  (`.swarmforge/tmux/*.sock`, `.swarmforge/operator/operator-tmux.sock`), no
  leaked temp-dir fixture servers.
- `uptime` — load average 5.5-6.3 on 4 cores (~1.5x), under the 2x-cores
  bypass threshold; proceeded with full runs rather than deferring.
- No `extension/src/*.ts` changed anywhere in this ticket's diff → BL-149
  cooldown gate has no production file to gate; not invoked.

## Independent re-verification (ran directly, third time this parcel — coder, architect, now hardener)

All match the coder's and architect's claimed results exactly:

- `bb swarmforge/scripts/test/orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED.
- `bash swarmforge/scripts/test/test_handoffd_supervisor_job_reaper.sh` — ALL PASS (4/4).
- `bb swarmforge/scripts/test/bl886_vitest_orphan_reaper_janitor_property_runner.bb` — ALL PROPERTIES HOLD (300×2).
- `node swarmforge/scripts/test/bl886_vitest_orphan_reaper_supervisor_property_runner.js` — ALL PROPERTIES HOLD (12/12 exhaustive).
- `npx vitest run --config vitest.properties.config.mjs test/bl886VitestOrphanReaperFixtureRunnerInvariant.property.test.js` — 1/1 pass.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-886-...feature` — 11/11 scenarios pass.
- Both `required_wiring` entries re-confirmed present by direct grep
  (`reapable-hung-vitest?` call in `orphan_janitor_sweep_lib.bb:169`;
  `job-in-scope?` call in `handoffd_supervisor.bb:308`).
- Invariant 3 install-once guard re-confirmed by direct read of
  `propertyLaneFixtureRunner.js` (`abnormalExitHandlersInstalled` flag,
  early-return guard).
- Hotfix ledger: both `602c7d014c` and `1ecbe049fe` present, `stamp_ticket:
  BL-886`, confirmed by direct read of `backlog/hotfix-ledger.yaml`.

## BL-113 Gherkin soft mutation (owned by this role)

The feature has two `Scenario Outline:` blocks (scenarios 01, 04). Ran:

```
specs/pipeline/scripts/run_gherkin_mutation.sh \
  specs/features/BL-886-swarm-stamp-vitest-orphan-reaper-hotfix.feature "" \
  specs/pipeline/steps/bl886VitestOrphanReaperHotfixSteps.js soft
```

Result: `outcome: "pass"`, 12 mutants generated across both outlines
(scenario 01: 3, scenario 04: 9), **all 12 killed, 0 survived, 0 errors**.
Manifest stamped into the feature file. No equivalent-mutant judgment call
needed (BL-234 n/a — every mutated example value was load-bearing).

## Defect found and fixed (this pass)

Ran the full `npm test` unit suite as verification (not just the property
lane) — a step the coder's and architect's own evidence did not cover, since
neither ran the full suite themselves (both scoped their verification to the
named runners + this parcel's own property lane). Result: **3 failures**, not
the 2 the QA-approved BL-884 merge commit had already characterized as a
known unrelated host-load flake.

The extra failure: `test/tmpDirMigrationGuard.test.js` — "the real
extension/test/ tree has zero raw mkdtemp call sites outside the shared
helper" (BL-420 regression guard). Root cause:
`extension/test/bl886VitestOrphanReaperFixtureRunnerInvariant.property.test.js`
(coder-authored, this ticket) called `fs.mkdtempSync(path.join(os.tmpdir(),
...))` directly at line 71 instead of the shared `mkTmpDir()` helper
(`./helpers/tmpDir`) every other test in the tree goes through post-BL-420.
The coder's own verification never caught this because it only ran
`test:properties` (the property-lane config, `include:
['test/**/*.property.test.js']`) directly on this one file — never the main
unit suite, which is where `tmpDirMigrationGuard.test.js`'s real-tree scan
lives.

Fix: swapped the raw `fs.mkdtempSync` call for `mkTmpDir('bl886-listener-guard-prop-')`
(imported from `./helpers/tmpDir`), removed the now-unused `os` import. Kept
the existing manual `fs.rmSync` in the `finally` block for early per-run
cleanup (an explicitly supported pattern per `tmpDir.js`'s own comment —
`sweepPendingTmpDirs` tolerates an already-removed path). This is a
convention-compliance fix within the coder's own newly-added test file, not
new product behavior.

Re-verified after fix:
- `npx vitest run test/tmpDirMigrationGuard.test.js` — 11/11 pass (guard
  clean).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl886VitestOrphanReaperFixtureRunnerInvariant.property.test.js` — 1/1
  pass (property still holds through the shared helper).

## Remaining 2 failures — confirmed pre-existing, unrelated

`test/renderBriefingDiagramsCli.test.js`'s 2 failing tests (of 4) reproduced
in the full-suite run reran clean in isolation:
`npx vitest run test/renderBriefingDiagramsCli.test.js` → 4/4 pass, 13.3s
total, no timeout. Matches the QA-approved BL-884 merge commit's own
characterization verbatim ("3 failures in renderBriefingDiagramsCli.test.js
reproduced as pure host-load timeouts, confirmed unrelated - all 4 tests
pass in isolation"). Not a regression introduced by this parcel or this
pass; not investigated further per that prior confirmation.

## Full suite (post-fix)

Re-ran `npm test` after the fix; only the two known pre-existing
host-load-timeout failures in `renderBriefingDiagramsCli.test.js` remain
(same class QA already dispositioned on BL-884). No other failures.

## Process hygiene at handoff

`pgrep -fl 'node --test|stryker'` and `pgrep -afl tmux` re-checked clean
after all runs — no orphaned processes, no leaked fixture tmux servers.

## Disposition

Hardened. One real defect found (BL-420 raw-mkdtemp convention violation in
the coder's own new property test file) and fixed within this parcel — a
mechanical convention fix to a file this ticket itself introduced, not a
bounce-worthy defect outside the ticket's scope. CRAP/DRY not applicable (no
production TS in this diff). Gherkin mutation clean (12/12 killed). All
named runners, property suites, and the acceptance feature re-verified
green a third time. Forwarding to documenter.

By hardener.
