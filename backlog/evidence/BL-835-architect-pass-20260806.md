# BL-835 — architect review pass — 2026-08-06

**Verdict: NONE.** No defects found. Parcel forwarded to hardener unchanged in substance.

**Commit reviewed:** `ca569e09b4` (cleaner tip; coder `17ba35e7` + cleaner `ca569e09b4`
against spec base `d6e3c9d3`), merged into this branch as this evidence commit's parent.

## Inventory

1. **Dependency-rule gate (`node extension/out/tools/dependency-gate.js <changed-files>`)**
   — RUN. The parcel's 8 changed files (5 named substrate files + the two new
   BL-835 test/step files + `swarmforge.conf`) are all outside `extension/src`
   and `extension/media` — depcruise correctly cannot resolve them (that scope
   boundary is the VS Code extension's own module graph). Sanity-checked the
   tool itself with a full-repo scan (no args): it runs and reports pre-existing,
   unrelated `acyclic` violations among `telegram-front-desk-bot.ts` /
   `telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts` — none
   of those files are touched by this parcel. N/A for this parcel, not skipped.

2. **Co-change / logical coupling (`node extension/out/tools/co-change-report.js
   <changed-files>`)** — RUN. `flow_watchdog_lib.bb` <-> `handoffd.bb` shows
   6 co-changes (SUSPECTED COUPLING flag), but this is the documented, deliberate
   design: flow_watchdog_lib.bb's own header comment states handoffd is its
   "sweep sibling" (design option (a)) — handoffd owns role enumeration and
   hosts the sweep loop that calls into the pure lib. The parcel's own diff to
   handoffd.bb is 4 lines (wiring :completed-dir/:abandoned-dir into the
   existing role-inboxes map for calibration) — not new coupling, an extension
   of the pre-existing relationship. No action.

3. **Invariants review (3 declared, BL-654)** — all three have non-vacuous
   property tests authored by the coder in
   `swarmforge/scripts/test/bl835_flow_watchdog_threshold_gate_property_runner.bb`,
   confirmed passing (`bb .../bl835_flow_watchdog_threshold_gate_property_runner.bb`
   → `ok`):
   - P1 reject-gate-not-a-floor — matches invariant 1 exactly; generator
     demonstrably reaches both the sub-gate-reject and gate-clearing branches.
   - P2 resolution-hides-route-identity-from-decide-tier — matches invariant 2;
     differential property over two structurally different routes resolving to
     the same numeric pair.
   - P3 rejected-or-absent-calibration-still-resolves — matches invariant 3;
     reaches both an empty/fully-rejected table and a populated one, asserts
     no throw and a usable pair.
   `decide-tier` itself is untouched by this ticket and its
   `tier-decision-input-keys` set is unchanged (`#{:age-ms :warn-ms
   :escalate-ms :highest-tier-alarmed :snoozed?}`) — the structural
   no-suppression guarantee (acceptance-05) is intact.

4. **Property-testing pass (undeclared properties on touched pure modules)** —
   the new pure surface (`percentile-ms`, `thresholds-from-samples`,
   `build-threshold-table`, `resolve-thresholds`, `spec-key`/`to-type-key`/
   `type-key`, `dwell-record-from-headers`, `calibrate-threshold-table`,
   `threshold-table-stale?`) is already covered by a combination of the
   example-based unit suite (`flow_watchdog_test_runner.bb`, including a direct
   regression for this exact bug: "thresholds-from-samples rejects (nil) when
   raw p67 sits below min-warn-ms") and the three declared-invariant property
   tests above. No additional property-shaped gap found; none added.

5. **Correctness read** — the fix replaces the floor-clamp
   `(max min-warn-ms (long warn-raw))` with a reject gate
   `(when (>= warn-ms min-warn-ms) ...)` in `thresholds-from-samples` — verified
   no `(max min-warn-ms ...)` pattern remains anywhere in the file. Verified via:
   - unit runner: `ALL PASS: flow_watchdog_lib.bb`
   - property runner: `ok` (above)
   - wiring test: `bash swarmforge/scripts/test/test_handoffd_flow_watchdog_wiring.sh`
     → both PASS lines
   - acceptance: `node specs/pipeline/cli.js
     specs/features/BL-835-flow-watchdog-floored-percentile-false-alarms.feature`
     → 4/4 scenarios pass (`# pass 4`, `# fail 0`)
   - regression: `node specs/pipeline/cli.js
     specs/features/BL-577-flow-watchdog-parcel-age-invariant.feature`
     → 22/22 scenarios still pass (`# pass 22`, `# fail 0`)

6. **Stale comment (Fix item 2)** — confirmed corrected: the percentile-section
   comment now reads "Sparse specs fall through `*->to|type` → global (...)
   `*->*|type` row is still written into the table for observability, but
   `resolve-thresholds` below does not consult that row" — matches the actual
   `resolve-thresholds` candidates list (`spec-key`, `to-type-key` only).

7. **Cleaner's dedupe commit (`ca569e09b4`)** — collapses
   `build-threshold-table`'s three near-identical group-by blocks into one loop
   over `[[key-fn source] ...]`. Verified behavior-preserving: the three
   fallback levels use disjoint key prefixes (`from->to|`, `*->to|`, `*->*|`),
   so `into {}` order across levels cannot collide or change which entry wins;
   same order (exact, to-type, type) preserved.

8. **Substrate / out-of-scope guardrails** — confirmed `main` still has zero
   occurrences of `thresholds-from-samples`/`min-warn-ms`
   (`git show main:swarmforge/scripts/flow_watchdog_lib.bb | grep -c ...` → 0),
   consistent with the ticket's substrate note; this worktree carries the adopt
   deliberately as named scope. Diffed for the ticket's `out_of_scope` list
   (BL-650, `*->*|type` reintroduction into `resolve-thresholds`, BL-827's
   ceiling options, snooze/unsuppressable posture, global defaults) — none
   touched. Working tree has one pre-existing untracked file
   (`swarmforge/scripts/operator_path_lib.sh`, matches paused BL-796) not
   created by this pass — left alone, not staged.

## Blocked checks

None. Every check above ran to completion.
