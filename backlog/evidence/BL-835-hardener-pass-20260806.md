# BL-835 — hardener review pass — 2026-08-06

**Verdict: NONE.** No defects found. Two coverage gaps closed with new unit tests;
both new tests verified to catch real hand-authored mutants before being left in
place. Parcel forwarded to documenter.

**Commit reviewed:** `92298b222d` (architect's evidence commit on top of
coder `17ba35e7` + cleaner `ca569e09b4`, spec base `d6e3c9d3`).

## Mutation tooling

No mutation tool is wired for Babashka (`engineering.prompt` Startup Tools —
`clj-mutate`/`crap4clj`/`dry4clj` not pinned/installed/invoked; BL-472 tracks
wiring one). Per BL-638, fell back to a hand-authored surgical mutation sweep
over the parcel's own changed pure functions instead of skipping the gate.

## Inventory

1. **Baseline suites (re-run, all green before any change):** unit runner
   (`flow_watchdog_test_runner.bb` → `ALL PASS`), property runner
   (`bl835_flow_watchdog_threshold_gate_property_runner.bb` → `ok`), wiring
   test (`test_handoffd_flow_watchdog_wiring.sh` → 2/2 PASS), acceptance
   (`BL-835-flow-watchdog-floored-percentile-false-alarms.feature` → 4/4),
   regression (`BL-577-flow-watchdog-parcel-age-invariant.feature` → 22/22).

2. **Hand-verified mutants already killed by the existing suite** (read, not
   applied — the existing assertions were traced against each mutant by
   inspection): `>=`→`>` in `thresholds-from-samples`'s gate check (boundary
   test at line ~605 has raw p67 land exactly on `min-warn-ms`); dropping the
   `(inc warn-ms)` strict-above-warn force in escalate computation (flat-sample
   test at line ~627 would collapse warn==escalate); swapping
   `resolve-thresholds`'s candidate order or adding `type-key` as a third
   candidate (both covered by the exact/to-type/skip-type-fallback assertions
   at line ~642); `Math/ceil`→floor in `percentile-ms` (evenly-spaced 10-sample
   p67/p97 assertions pin exact index values). `build-threshold-table`'s
   fallback-level iteration order was checked and found to be an equivalent
   mutant if reordered — the three key-fns write disjoint key namespaces
   (`from->to|`, `*->to|`, `*->*|`), so `into {}` order cannot change which
   entry wins; not exercised further (BL-234).

3. **Real coverage gap found and closed:** `threshold-table-stale?` and the
   `read-threshold-table`/`write-threshold-table!` JSON round-trip had **no**
   direct unit test. Every existing use is a single `run-sweep!` call against
   an empty daemon-dir, which only ever exercises the `(nil? at)` always-stale
   branch and never actually reads back what it wrote (`ensure-threshold-table!`
   returns the freshly-computed in-memory table on that path, not a disk
   round-trip). Two mutants were hand-applied to prove this was a real gap,
   then killed by two new test blocks added to `flow_watchdog_test_runner.bb`:
   - Mutant A: the elapsed-time disjunct in `threshold-table-stale?` replaced
     with `false` (table never re-goes-stale after the first calibration,
     freezing thresholds forever). Failed the new boundary assertion
     ("...true exactly at the recalibration window") before the fix; the prior
     suite would have stayed fully green.
   - Mutant B: `read-threshold-table`'s keyword→string spec-key normalisation
     removed (`[k ...]` instead of `[(if (keyword? k) (name k) (str k)) ...]`).
     Cheshire's keywordized JSON keys then never match `resolve-thresholds`'
     string lookups, silently falling through to the global pair — no crash,
     matching the never-disable invariant, so a broken read looks healthy.
     Failed all three new round-trip assertions before the fix; the prior
     suite would have stayed fully green (this is exactly the "safe default
     masks lost signal" pattern this role's lessons warn about).
   Both mutants reverted; the added tests are the permanent fix and pass
   against the real implementation (`ALL PASS: flow_watchdog_lib.bb`, confirmed
   after revert).

4. **CRAP / DRY (jscpd, `.jscpd.json` `pattern: "**/*.ts"` run from `extension/`,
   `npm run crap`/`npm run dry` scoped to `extension/src`)** — N/A. Zero files
   under `extension/src` or `extension/media` touched by this parcel (confirmed
   via `git diff --stat -- extension/src extension/media` against the parcel's
   merge-base: empty). Same N/A the architect recorded for the dependency-gate
   check, for the same reason.

5. **Property-test separation** — the new tests added here live in the example-based
   unit runner (`flow_watchdog_test_runner.bb`), not in the property runner; no
   property-tagged file was touched, no property assertion counted toward this
   inventory.

6. **Process hygiene** — no orphaned `bb`/`node --test`/`stryker` processes
   left running after any run (`pgrep -fl` scoped to this worktree, checked
   before and after). Host load was high throughout (`uptime` ~100-118 on
   this host); no Stryker/JS mutation run was attempted (Babashka-only parcel,
   N/A per item 4), so the load-avoidance rule for Stryker dry-runs did not
   apply here.

7. **Scope guardrails** — diffed against the ticket's `out_of_scope` list
   (BL-650, `*->*|type` reintroduction, BL-827's ceiling options, snooze/
   unsuppressable posture, global defaults): none touched by this pass. The
   pre-existing untracked `swarmforge/scripts/operator_path_lib.sh` (matches
   paused BL-796) remains present and untouched — not created by this pass,
   not staged.

## Blocked checks

None. Every check above ran to completion.
