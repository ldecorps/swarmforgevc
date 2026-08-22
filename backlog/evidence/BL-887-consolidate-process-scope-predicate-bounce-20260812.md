# BL-887 QA bounce evidence — 2026-08-12

Commit under test: `97b4069589c996617848a10bf39151553bef0f13` (documenter,
"BL-887: document scope-predicate consolidation in Specification.MD").
Lineage confirmed: BL-887's coder commit `f7b69d7a85cd7a8c87f065ea8fa0dd24bd6784a3`
and specifier spec commit `e41481b54` are both ancestors of the cited commit
(`git merge-base --is-ancestor` for each, both true).

## Complete gate inventory (Article 4.4 — one bounce, every item)

- **Sibling disposition** (`qa-sibling-check.js status --ticket BL-887`): `VERIFY BL-887` — no open deferral. PASS.
- **Required wiring grep** (ticket's own e2e step 5): `project-scoped-process?`
  defined once in `swarmforge/scripts/process_table_lib.bb`, one delegating
  call site each in `handoffd_supervisor.bb`/`job-in-scope?` and
  `orphan_janitor_lib.bb`/`project-scoped-path?`, no surviving private
  `in-path?` closure. PASS.
- `bb swarmforge/scripts/test/orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED.
- `bash swarmforge/scripts/test/test_handoffd_supervisor_job_reaper.sh` — ALL PASS (04-07).
- `bb swarmforge/scripts/test/bl886_vitest_orphan_reaper_janitor_property_runner.bb` — 300 runs each P1/P2/P3 + 1 deterministic regression, ALL PROPERTIES HOLD.
- `node swarmforge/scripts/test/bl886_vitest_orphan_reaper_supervisor_property_runner.js` — 12/12 + 4/4 exhaustive combinations, ALL PROPERTIES HOLD.
- `bb swarmforge/scripts/test/bl887_scope_predicate_invariants_property_runner.bb` — 300 runs each P1/P2, ALL PROPERTIES HOLD (property logic itself is correct; see D1 below for a separate hygiene defect in this same file).
- `bb swarmforge/scripts/test/process_table_lib_test_runner.bb` — ALL CHECKS PASSED.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh specs/features/BL-887-consolidate-process-scope-predicate.feature`) — 6/6 scenarios pass (all 5 Scenario Outline rows + the janitor reap-candidate scenario).
- `npm run test:properties` (extension) — 76 files / 240 tests, ALL PASS. 4 unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` errors logged but attached to no failing test — consistent with the machine load noted below, not a defect.
- `npm test` (extension full unit suite) — 3 files / 5 tests failed:
  - `bounceDrain.test.js` (1) and `renderBriefingDiagramsCli.test.js` (3): all four failed with the generic vitest-worker RPC-timeout stack (`STACK_TRACE_ERROR`), coinciding with the run's own "suite duration over budget: 271.2s exceeds the 10.0s suite budget" warning and 26 files individually over their per-file budget. Host load at time of run: `load averages: 15.41 15.70 10.57` on a 4-core machine (`sysctl -n hw.ncpu` = 4), matching the known timeout-under-load pattern (see repo lesson on Stryker dry-run timeouts under load — the same class of flakiness, different runner). Re-ran both files in isolation (`npx vitest run test/bounceDrain.test.js test/renderBriefingDiagramsCli.test.js`): 2 files / 25 tests, ALL PASS, 22.42s. Confirmed environmental, not a BL-887 defect. Neither file touches process-scope/orphan-janitor/supervisor code.
  - `tempDirTrapGuard.test.js` (1): **real defect, D1 below.**
- Orphaned test processes: `pgrep -fl 'node --test|stryker'` empty before and after the full run. PASS.

## D1

1. **Failing command**: `npm test` (extension), specifically
   `test/tempDirTrapGuard.test.js` > "the real swarmforge/scripts tree has
   zero temp-dir-trap violations".
2. **Commit hash**: `97b4069589c996617848a10bf39151553bef0f13`.
3. **First error excerpt**:
   ```
   AssertionError [ERR_ASSERTION]: expected zero temp-dir-trap violations under swarmforge/scripts, found:
   /Users/ldecorps/projects/swarmforgevc/.worktrees/QA/swarmforge/scripts/test/bl887_scope_predicate_invariants_property_runner.bb: creates a temp root (fs/create-temp-dir) but has no shutdown hook and no try/finally delete-tree
   + actual - expected
   + [
   +   {
   +     file: '.../swarmforge/scripts/test/bl887_scope_predicate_invariants_property_runner.bb',
   +     reason: 'creates a temp root (fs/create-temp-dir) but has no shutdown hook and no try/finally delete-tree'
   +   }
   + ]
   - []
   ```
4. **Failure class**: `unit`.
5. **Expected vs observed**: expected zero temp-dir-trap violations under
   `swarmforge/scripts` (the standing guard every other `.bb` runner in that
   directory satisfies); observed one violation in the new
   `bl887_scope_predicate_invariants_property_runner.bb` — it creates a temp
   root at line 107 (`(def root (str (fs/real-path (fs/create-temp-dir))))`)
   and deletes it at line 181 (`(fs/delete-tree root)`) with nothing between
   wrapping the body in a shutdown hook or `try`/`finally`, so any exception
   or early exit between those lines leaks the directory.

**Blamed role**: coder — this file was introduced whole by commit
`f7b69d7a8` ("BL-887: consolidate job-in-scope?/project-scoped-path?...",
"By coder."); no cleaner/architect/hardener commit touched it afterward.

**Remediation pointer**: `swarmforge/scripts/test/bl887_scope_predicate_invariants_property_runner.bb:107-181`.
This is an established, consistently-applied convention across every other
`.bb` runner in `swarmforge/scripts/test/` (40+ files) — either register a
`Runtime/addShutdownHook` cleanup as in e.g.
`swarmforge/scripts/test/bl679_ambulance_perimeter_property_runner.bb:43-47`,
or wrap the body in `(try ... (finally (fs/delete-tree root)))` as in
`swarmforge/scripts/test/orphan_janitor_lib_test_runner.bb:426-469`. The
sibling files this same commit added
(`bl887_scope_predicate_classify_runner.bb`,
`process_table_lib_test_runner.bb`) create no temp dirs and are unaffected.
