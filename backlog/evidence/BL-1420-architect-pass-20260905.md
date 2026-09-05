# BL-1420 — architect pass, 2026-09-05

Ticket: BL-1420-the-freshness-fixtures-pass-the-registry-guard
Role: architect
Commit reviewed: c00d3d56d0 (cleaner NONE pass)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: nothing suspicious.
- **jscpd**, independently re-run (new helper against BL-1399's own
  pre-existing fixture, the file the ticket's "How" section names as a
  potential third consumer): `0 clones` — confirms the cleaner's own
  judgment that leaving BL-1399's working fixture untouched is not a
  mechanical DRY violation, matching this session's established precedent
  of leaving pre-existing, unrelated, working duplication alone
  (BL-1287/BL-1419).
- **Register check**: neither `backlog/standing-reds.tsv` nor
  `swarmforge/scripts/property_suite_standing_allowlist.tsv` names this
  file family.

## Invariants Review (BL-633/654) — re-verified live, not just trusted

1. **"Every fixture... derives its supervisor conf rows from the same
   *_supervisor.bb glob the guard walks... no fixture carries a
   hand-written supervisor list"** — read `freshnessFixture.js`'s
   `supervisorNames()` (JS side) and the bb runner's own `supervisor-names`
   (Clojure side): both glob `*_supervisor.bb`, injectable to a scratch
   directory. Confirmed the required_wiring anchors are all live
   (`FRESHNESS_REQUIRED` present in all three named files).
2. **"A harness never turns a checker exit it did not expect into an
   observation"** — read `run-checker!`: branches on `(:exit result)`
   explicitly, returning `{:ok? false :stderr ...}` on non-zero; the main
   loop reports that as a failed property run and evaluates none of
   P1-P4 or the coverage counters over it (confirmed by reading the `if`
   branch structure directly — the properties live entirely inside the
   `ok?` truthy branch).
3. **"The guard, the checker and the live conf files are untouched"** —
   `git diff f18fccd9e2~1 f18fccd9e2 --name-only | grep
   daemon_log_freshness` — empty, confirmed myself.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up the property runner, stripped `write-guard-satisfying-rows!`
down to only writing the `FRESHNESS_REQUIRED` file (no conf rows, no
heartbeats — reproducing the pre-fix guard-refusal state): reran at
`PROPERTY_RUNS=5` — **13 failures**, the checker genuinely exiting
non-zero with `FRESHNESS_REGISTRY_GUARD: unclassified supervisor script
'bridge_headless_supervisor'...`, correctly caught by the new
`P-checker` property rather than silently passing. Restored the file,
confirmed byte-identical via `diff` and `git status --short` (empty),
reran at default run count — `ALL PROPERTIES HOLD`, 48 runs, real
coverage across all 8 generator classes.

## Independently re-verified the substance

- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1011-a-freshness-alarm-names-its-swarm-and-its-reason.feature`
  — **8/8 pass** (was 0/8).
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1012-the-freshness-watchdog-stops-manufacturing-its-own-incidents.feature`
  — **9/9 pass** (was 0/9).
- `bb swarmforge/scripts/test/bl1011_freshness_attribution_property_runner.bb`
  (default and `PROPERTY_RUNS=40`) — **ALL PROPERTIES HOLD**, real
  coverage across all 8 classes both times.
- `node specs/pipeline/cli.js
  specs/features/BL-1420-the-freshness-fixtures-pass-the-registry-guard.feature`
  — **6/6 pass**.
- `node specs/pipeline/cli.js` on `BL-1399` and `BL-784` (regressions) —
  **3/3, 3/3 pass**.

All matching both the coder's and cleaner's claimed counts exactly.

## required_wiring

All four anchors confirmed present: `FRESHNESS_REQUIRED` in both step
handlers and the bb property runner; the new step handler discovered by
directory scan (BL-1371), confirmed by the acceptance run passing 6/6.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. Forwarding to hardener.
