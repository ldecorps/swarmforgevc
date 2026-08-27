# BL-904 architect pass — 2026-08-19

## Reviewed commit
`a7894cdd154bea4440bd924b83908217dabed267` ("BL-904: derive the sidecar's
daemonRestarts from the freshness incident log", By coder, forwarded
unchanged by cleaner).

## Checks run (complete inventory, not first-failure-stop)

1. **Dependency-rule gate** (`dependency-gate.js`) against all 5 changed
   extension files: PASSED, no forbidden edges.
2. **Co-change report** (`co-change-report.js`): the flagged coupling
   (`swarmMetrics.ts` ↔ its own test file, the `swarm-metrics.ts` CLI tool,
   `bridgeServer.ts`) is pre-existing, expected fan-out for a shared metrics
   module — nothing new or specific to this change.
3. **Unit tests** (`costHealthSidecar.test.js`, `swarmMetrics.test.js`,
   both import from `../out/...`): 137/137 pass, after `npm run compile`
   (stale `out/` initially failed 13 tests with `freshnessIncidentLogPath is
   not a function` — a compile-artifact gap in my own environment, not a
   coder defect; resolved by compiling before testing).
4. **Property tests** (`costHealthSidecar.property.test.js`): 2/2 pass.
   Independently re-verified non-vacuous myself (not just trusting the
   commit message) with two of my own break tests, each compiled, run, and
   reverted:
   - Invariant 1: removed the `event.action !== 'restart'` filter in
     `bucketDailyDaemonRestarts` (so escalates count as restarts). Property
     failed cleanly: `expected today's value to be 0 (1 events drawn), got
     1`, shrunk to a single escalate event.
   - Invariant 2: changed `bucketDailyDaemonRestarts`'s `events === null`
     branch to return `[]` instead of `null` (collapsing "no data" into
     "readable, empty"). Property failed cleanly: `expected
     bucketDailyDaemonRestarts(null, ...) to always be null`.
   Both breaks reverted; recompiled and reconfirmed green.
5. **Acceptance feature** (`BL-904-sidecar-daemon-restarts-hardcoded-zero.feature`):
   7/7 scenarios pass. Fixture-dir count before/after: 0 → 0 (the coder
   applied the guarded/terminal cleanup pattern from BL-905's own architect
   bounce earlier this session, correctly, from the start).
6. **Invariant 2's distinguishability mechanism, checked by hand**: traced
   `trendedDaemonRestarts` → `computeTrend` end to end. A missing/unreadable
   log yields `{ value: 0, trend: { series: [], currentValue: null,
   direction: 'unknown' } }`. A readable log with zero `restart` records
   still produces a **non-empty** one-point series via `fillDailyBuckets`
   (today's bucket, value 0), yielding `{ value: 0, trend: { series:
   [{...}], currentValue: 0, direction: 'unknown' } }`. Both cases can show
   `direction: 'unknown'` (a single-point series can never establish a
   direction either) — so `direction` alone does NOT reliably distinguish
   them, despite the ticket's own prose leaning on it ("`trend.direction:
   'unknown'` already exists to express it"). The actual, reliable signal is
   `trend.currentValue === null` / `trend.series.length === 0`, and I
   confirmed both the implementation and the step handlers
   (`bl904SidecarDaemonRestartsSteps.js` lines 182-183, 242-243, 254-256)
   use exactly that — never `direction` alone. Not a defect: the
   implementation is more careful than the ticket's own hint, and
   invariant 2 genuinely holds.
7. **Architecture boundary checks**: no webview/tmux/host-IO/secrets code
   touched; N/A. `costHealthSidecar.ts`/`swarmMetrics.ts` stay in the
   extension-host metrics layer, consistent with existing siblings.
8. **BL-213 stale-comment fix**: confirmed in the diff — the coder also
   replaced a second stale placeholder-justifying comment on
   `ReliabilityCounts.daemonRestarts` ("no daemon-restart telemetry event
   type exists... filled in once that event type exists"), same defect
   class as the ticket's own test-enshrinement finding, just in prose. Not
   required by the ticket's letter but squarely in its spirit; no scope
   concern (same field, same file).

## Design ruling: TOTAL vs per-daemon (the decision the ticket reserves for this stage)

The ticket explicitly reserves this call for architect review: *"Prefer the
[per-daemon] shape... unless the sidecar's consumers make that expensive."*
The coder built a single TOTAL count.

**Ruling: accept TOTAL for this ticket.** Reasoning:
- The raw per-daemon data is not lost — `FreshnessIncidentEvent.daemon` is
  captured by `readFreshnessIncidentEvents` and available for a future
  ticket to aggregate differently, at no cost paid now.
- The ticket's own concrete acceptance bar (`qa_e2e_procedure`, all 6 steps,
  and every acceptance scenario) verifies only a single hand-counted total
  ("the daemon restart count is 155") — never a per-daemon breakdown. The
  human-approved, checkable definition of done does not require it: if the
  specifier who wrote the concrete e2e steps intended per-daemon, the steps
  would have said so.
- `ReliabilityCounts.daemonRestarts: TrendedNumber` is the same shared type
  used by all five reliability fields; a per-daemon breakdown would need a
  different shape (e.g. `Record<string, TrendedNumber>`), which ripples
  into the briefing renderer and PWA dashboard — both explicitly out of this
  ticket's stated scope ("Not... the other four reliability counts", and
  more broadly not any renderer). Making that call now would be an
  unscoped expansion, not a contained fix.
- This ticket's actual, urgent purpose — a lying `daemonRestarts: 0` next to
  248 real restarts — is fully fixed by the total. Per-daemon breakdown is a
  real, valuable enhancement, not a blocker for closing the defect this
  ticket exists to close.

Not bouncing for this. Recommend a follow-up ticket for per-daemon
breakdown when a consumer actually needs "which daemon is storming" at a
glance; noting it here per the ticket's own request for a recorded
architect decision, not filing a `rule_proposal` (this is a feature idea,
not a durable process rule) or a blocking `note` (nothing here blocks this
ticket).

## Verdict
No architecture violation, no correctness defect. Both declared invariants
hold, independently verified non-vacuous. Forwarding to hardener.

By architect.
