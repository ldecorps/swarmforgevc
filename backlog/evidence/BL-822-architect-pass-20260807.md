# BL-822 — architect pass (2026-08-07)

## Received

`git_handoff` from cleaner, commit `25c24fd156` (merge_and_process, task
`BL-822-resource-anomalies-miss-host-load-spikes`), bundled with
BL-839/BL-773/BL-819 in one coder→cleaner batch commit. Merged into
`swarmforge-architect`.

## Scope

New ticket, first architect pass. Adds host-load (`os.loadavg()[0] /
os.cpus().length`, sustained-window) as a sibling signal on
`CostHealthSidecar`, additive to the existing per-role RSS/CPU anomaly
detector, per the two specifier rulings in the ticket description.

## Three declared invariants — property coverage checked first (BL-654)

All three have real coverage in
`extension/test/bl822HostLoadAnomaly.property.test.js` (6 properties), run
via `npm run test:properties` and green:

```
✓ test/bl822HostLoadAnomaly.property.test.js (6 tests)
```

- Invariant 1 (a severe day never reports resource-quiet): two properties —
  severe host load + a forced real per-role anomaly still forbids "none
  found" AND still renders the anomaly (this is BL-822's own anti-vacuity
  design: a check that only asserts "none found is absent" would pass
  vacuously on the real 2026-08-06 data, which had one role anomaly
  present); severe host load + zero per-role anomalies also forbids "none
  found". A third property (quiet host + zero anomalies still reports "none
  found") guards against the degenerate fix of never rendering "none found"
  at all, which would trivially satisfy the first two without actually
  consulting host load.
- Invariant 2 (per-role detection unchanged, additive only):
  `resourceAnomalies` is asserted byte-identical whether or not a hostLoad
  verdict is passed, across 100 randomized per-role trend mixes.
- Invariant 3 (`resourceSamplesObserved` keeps its narrower meaning):
  asserted byte-identical with/without hostLoad across the same 100 mixes,
  plus a dedicated property that a severe hostLoad verdict with zero
  resolvable role pids never flips it true.

The test file's own header documents the non-vacuity check performed before
landing (each property re-verified to fail against a deliberately broken
implementation, then pass again once reverted) — read and spot-confirmed
plausible against the actual `renderAnomalyLines` implementation below,
rather than taken on faith.

## `required_wiring` — all three confirmed present by reading the code

1. `costHealthSidecar.ts::hostLoad` — `CostHealthSidecar.hostLoad?:
   HostLoadVerdict` field exists (line 150) and `buildCostHealthSidecar`
   actually sets it (`sidecar.hostLoad = hostLoadVerdict`, line 404), not
   just computed and discarded.
2. `costHealthSidecar.ts::renderAnomalyLines` — the "none found" branch's
   guard is `if (anomalies.length === 0 && !severe)`, where `severe =
   hostLoad?.severe === true` — the rendered verdict genuinely consults
   host load, not just the JSON field. A severe day pushes
   `renderHostLoadLine` even when `anomalies` is otherwise empty.
3. `sample-resources.ts::host load` — the headless CLI's call site
   (`sampleRolesOnce`, unchanged) now internally samples host load
   (`getHostLoadRatio()` → `appendHostLoadSample`) on the same tick,
   BEFORE the per-role loop and independent of whether any role pid
   resolves — confirmed by reading `resourceTelemetry.ts:198-220`. Both
   callers of `sampleRolesOnce` (the host-side `setInterval` sampler and
   this headless CLI) get the coverage from one shared function, so the
   BL-350 headless gap does not reopen for this new signal.

## Other checks run

- Unit: `npx vitest run test/resourceTelemetry.test.js
  test/costHealthSidecar.test.js test/sampleResourcesCli.test.js` — 138/138
  PASS (3 files).
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-822-resource-anomalies-miss-host-load-spikes.feature` —
  9/9 scenarios PASS. Step handlers (`bl822HostLoadAnomalySteps.js`) drive
  the real compiled `out/metrics/resourceTelemetry` and
  `out/notify/costHealthSidecar` modules in-process — no mock standing in
  for the logic under test.
- Dependency gate (REQUIRED HARD GATE):
  `node out/tools/dependency-gate.js src/metrics/resourceTelemetry.ts
  src/notify/costHealthSidecar.ts src/tools/sample-resources.ts` —
  `Dependency-rule gate PASSED: no forbidden edges.`
- Co-change (`co-change-report.js`, informational): the three changed files
  show expected coupling with their own test/step-handler files and with
  each other (all three ARE one feature); `costHealthSidecar.ts`'s wider
  co-change list is pre-existing hub-file history from unrelated tickets
  (BL-551/BL-552/etc.), not new coupling introduced here.
- `swarmforge.conf`: the two new dials
  (`host_load_severe_ratio`/`host_load_sustained_minutes`) are added
  commented-out with code defaults as the single source of truth, matching
  the project's existing `config <key> <value>` override convention and
  explicitly placed to not contradict `mutation_busy_load_multiplier`'s
  existing threshold (per the ticket's own ruling 2 rationale).
- Architecture: all three changed files are extension-host code
  (metrics/notify/tools) — no webview file touched, no browser storage, no
  secrets, no direct process-spawn bypassing tmux. Two-layer boundary
  intact.
- Scope: BL-847 (the wrong-pid finding surfaced by the same probe) was
  correctly split out by the specifier as its own paused ticket rather than
  folded in here — this parcel does not touch pid resolution.

## Verdict

All three declared invariants have real, non-vacuous property coverage; all
three `required_wiring` items confirmed wired by reading the actual call
sites; all checks pass; dependency gate clean. No architecture violations,
no correctness defects found. Forwarding to hardener.

By architect.
