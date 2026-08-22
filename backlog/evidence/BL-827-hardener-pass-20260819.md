# BL-827 hardener pass — 2026-08-19

## Reviewed commit
`68056982e0` ("Merge cleaner BL-827 into architect"), merged into
hardener at `03dca0ba2` (conflict in `specs/pipeline/steps/index.js`
resolved: kept BL-955's line, added `bl827FlowWatchdogSpecThresholdsSteps`,
excluded `bl956PipelineBoardCaptionCapSteps` — that file was already
deleted on my branch by the BL-956 scoped revert; the architect's branch
predates that revert and never saw it).

## Process note
No dedicated `backlog/evidence/BL-827-architect-*` pass file exists, same
as several other tickets in this batch. Given this is medium-cost feature
work closing three explicitly-scoped gaps plus a human-decided adaptation
ceiling, I independently re-derived all three gap closures and the
ceiling implementation from source rather than trusting the coder's
commit message.

## Scope
`swarmforge/scripts/flow_watchdog_lib.bb` (220 lines changed),
`swarmforge/scripts/test/flow_watchdog_test_runner.bb` (extended, +145),
new `swarmforge/scripts/test/bl827_flow_watchdog_thresholds_property_runner.bb`
(+180), `swarmforge/swarmforge.conf` (+8, ceiling factor config), new
`specs/pipeline/steps/bl827FlowWatchdogSpecThresholdsSteps.js` (+431),
`specs/features/BL-827-flow-watchdog-spec-dependent-thresholds-adopt.feature`.

## Checks run (complete inventory, not first-failure-stop)

1. **Unit suite**: `bb swarmforge/scripts/test/flow_watchdog_test_runner.bb`
   → `ALL PASS: flow_watchdog_lib.bb`.
2. **Property suite**: `bb swarmforge/scripts/test/bl827_flow_watchdog_thresholds_property_runner.bb`
   → `ok (400 runs/invariant, 88 malformed tables, 61 firing tiers, 141
   flat sets, 156 emitted pairs)`.
3. **Acceptance**: `specs/pipeline/scripts/run_acceptance.sh
   specs/features/BL-827-flow-watchdog-spec-dependent-thresholds-adopt.feature`
   (run from repo root, backgrounded under Monitor) — 8/8 pass, including
   scenario "decide-tier still never sees the route identity" and "the
   alarm says which threshold it fired against".
4. **Gap 1 independent re-derivation** (alarm states its threshold):
   `format-alarm-text` now destructures `threshold-ms`/`resolved-via` and
   appends `" Threshold <humanized> via <key>."` when both are present;
   `run-sweep!` sets `:threshold-ms (if (= tier :escalate) escalate-ms
   warn-ms)` and `:resolved-via resolved-via` on the alarm map before
   calling it. Confirmed by direct read, not the commit message.
5. **Gap 2 independent re-derivation** (dead `*->*|type` row): confirmed
   `type-key` fn is deleted entirely, `build-threshold-table`'s
   `fallback-levels` now has only `[spec-key "exact"]` and
   `[to-type-key "to-type"]`, and `resolve-thresholds`'s `candidates` list
   likewise has only the two levels — the coarsest row is no longer
   written OR consulted anywhere in the file (`grep -c type-key` → 0
   remaining definitions/call sites).
6. **Gap 3 independent re-derivation** (acceptance contract): feature file
   + `bl827FlowWatchdogSpecThresholdsSteps.js` exist and both ran (item 3
   above); step handler follows the `bl577FlowWatchdogParcelAgeInvariantSteps.js`
   fixture posture as instructed (confirmed via `grep -n
   "flow_watchdog_lib\|withFixtureClock\|recalibrationMs"` in the new
   step file — the 6h interval is injected, never slept out).
7. **Adaptation ceiling (human ruling, option b) independent
   re-derivation**: `default-calibration-ceiling-factor` = 4, config key
   `flow_watchdog_calibration_ceiling_factor` documented in
   `swarmforge.conf` matching the human's approved recommendation.
   `read-pack-aware-global-thresholds` computes `:calibration-ceiling-warn-ms`
   as `warn-ms * factor` and threads it through `run-sweep!` →
   `ensure-threshold-table!` → `calibrate-threshold-table` →
   `build-threshold-table` → `thresholds-from-samples`, which REJECTS
   (returns nil, falls through to global) any raw warn percentile above
   the ceiling rather than clamping it — same posture as the BL-835
   `min-warn-ms` reject gate, confirmed by reading the guard clause `(or
   (nil? ceiling-warn-ms) (<= warn-ms (long ceiling-warn-ms)))`.
8. **Invariant 3 hardening found already in place**: `sanitize-global-pair`
   (new) forces `escalate-ms` to at least `warn-ms + 1` on every global
   pair read (`read-thresholds` and `read-pack-aware-global-thresholds`
   both route through it), closing the case of a misconfigured conf whose
   `flow_watchdog_escalate_ms` sits at or below its warn — this extends
   the strictly-greater guarantee to the global-pair source, not just the
   calibrated-sample source `thresholds-from-samples` already had. Not
   explicitly demanded by the ticket text but directly serves invariant 3
   ("Escalate is strictly greater than warn for every resolved pair, from
   every source"); verified via property-suite malformed-table runs (88
   malformed tables exercised) and confirmed no case failed.
9. **required_wiring**: `handoffd.bb::completed-dir` — confirmed
   `role-inboxes-for-flow-watchdog` (BL-577's existing wiring) still
   supplies `:completed-dir`/`:abandoned-dir` per role, unbroken by this
   change (2 call sites, lines 884-885 and 1979-1980).
   `flow_watchdog_lib.bb::resolved-via` — confirmed reaches
   `format-alarm-text` per item 4 above.
10. **Invariant 2 structural check**: `decide-tier`'s destructured input
    is exactly `{:age-ms :warn-ms :escalate-ms :highest-tier-alarmed
    :snoozed?}` — five keys, no route/type/dormancy signal, unchanged by
    this ticket. `evaluate-parcel-tier` (the wrapper that assembles that
    map) is the only caller that sees route identity, matching the
    docstring's stated separation.
11. **Invariant 1 structural check**: `read-threshold-table` degrades to
    `{}` on absent/malformed JSON (never throws);
    `ensure-threshold-table!`'s `try/catch` returns the prior `current`
    table on any calibration exception (scenario 07 in the acceptance
    suite exercises this directly, confirmed passing).
12. **Tooling gate**: no mutation/CRAP/DRY tooling is pinned for Babashka
    (constitution, Startup Tools; BL-472). Ran the degraded
    unit-test-gap fallback instead (items 1-2 above) — recording per the
    ticket's own `verification:` instruction.
13. **Leak/process check**: `git status --short` clean after the merge
    commit; no orphaned `node --test`/`stryker` processes; all live tmux
    sockets are real (`.swarmforge/tmux/`, operator socket), no fixture
    leaks.

## Out-of-scope confirmation
Grepped the diff for any reintroduction of the BL-835-forbidden
`min-warn-ms` floor-clamp (`(max min-warn-ms warn-raw)`) — none found;
`min-warn-ms` remains a reject gate only. `decide-tier`, BL-650's
active-time clock, and the global config pair's retirement were all
correctly left untouched.

## Outcome
No defects found. All three gaps closed and independently re-derived
from source, the human's ceiling ruling (option b) correctly implemented
as a reject gate (not a clamp), invariants 1-3 hold both structurally and
under the property suite's 400 runs/invariant with 88 adversarial
malformed-table cases. `.bb` tooling gap recorded per constitution.

Forwarding to documenter.

By hardener.
