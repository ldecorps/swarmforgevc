# Raw intake — Bring extension unit suite wall-clock under 13 seconds

Status: new intake, not minted. Human via Cursor 2026-08-03 ~07:38 CEST.
Absolute priority alongside continuous day/evening/night shifts (pause +
nightly cooldown already cleared).

Related
- BL-445 (done) — ratchet + 10s budget verdict; suite later regressed hard.
- BL-362 / BL-363 — prior spawn-tax cuts from a ~13s baseline.
- BL-378 — per-file 7s hard budget (`check-suite-file-budget.ts`).
- BL-078 / BL-252 — suite-duration trend recording.
- `extension/scripts/recordTestDuration.js` + `SUITE_DURATION_BUDGET_MS = 10000`
  in `check-suite-duration-budget.ts` (still the durable 10s line; human's
  spoken target today is **under 13s** — treat 13s as the hard operational
  ceiling, 10s as the ratchet already in code).

## Goal

`npm test` in `extension/` records `duration_ms` **strictly under 13000**
(with headroom), without deleting tests or dropping coverage. Prefer
landing under the existing 10s budget if profile shows it is reachable.

## Problem

Measured 2026-08-03 on the host after clearing swarm pauses:

- `extension/.test-durations.jsonl` latest: `duration_ms: 169507` (~169.5s)
  for `test_count: 438`, result fail (vitest worker termination noise).
- Wall clock for the full `npm test` (compile + suite): ~190s.
- Budget surface: `suite duration over budget: 169.5s exceeds the 10.0s suite budget`.
- File count grew from ~100 (July) / ~273 (BL-445 era) to **438** test files.

The suite is again a correctness risk: slow suites get skipped, and
real-time waits hang the pipeline.

## Why this matters

Operator: bring unit-test execution duration under 13 seconds so the swarm
can run three shifts without the suite becoming a bottleneck or a skip.

## Success criteria

1. A clean `npm test` in `extension/` on an otherwise-idle host records
   `duration_ms < 13000` in `.test-durations.jsonl` (prefer `< 10000`).
2. `test_count` does not fall; coverage / CRAP gates do not regress.
3. Profile first (per-file report + fixed overhead: compile, vitest pool,
   coverage) — do not hit the number by deleting tests.
4. No new real-clock waits; keep per-file 7s hard gate.

## Out of scope

- Changing Gherkin / acceptance pipeline wall-clock (separate surface).
- Android JVM unit tests (not this suite).
- Raising `SUITE_DURATION_BUDGET_MS` to hide the regression.

## Priority

Human: absolute — schedule immediately after (or instead of, if cap-blocked)
current active work once mailboxes allow. Do not park behind medium adoption
tickets.
