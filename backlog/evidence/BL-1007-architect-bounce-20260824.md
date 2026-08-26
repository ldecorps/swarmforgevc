# BL-1007 — architect bounce — 20260824

## Review inventory (Article 4.4)

1. **Invariant 1 incomplete: `loadNormalizedDurationMs` is always null** —
   Declared attributable evidence must record the contention factor **and**
   each budgeted test's load-normalized duration so a red can be classified
   without a re-run at another load. `contentionBudgetSetup.js` pushes
   `loadNormalizedDurationMs: null` as a permanent placeholder; no reporter /
   `onTestFinished` / wall÷factor fill exists. Scenario 03 was softened to
   "field/list shape only", which does not satisfy the invariant. Close by
   recording real wall time scaled by the applied factor (or equivalent
   load-normalized duration) before forward; lock with a failing unit/
   property that rejects an all-null `tests[]` after a completed run.

## Inbound

Merged cleaner `cc423e92df` (on coder `75db2c55e1`) into
`swarmforge-architect`. Ancestry confirmed.

## What is otherwise sound

- Compile-free `contentionBudget.js` (vitest.config cannot import `out/`);
  ratio matches `sampleHostLoadRatio` arithmetic.
- Finite ceiling (`120000`); factor &lt; 1 / unusable → base; extremes clamp.
- `vitest.config.mjs` reads the helper (required_wiring); setup scales
  numeric `test()` timeouts while leaving source literals for BL-969.
- Property lane untouched (absolute 20000).
- Gates green: **11/11** Gherkin, **3/3** properties (pre-bounce).

## Gates (pre-bounce)

| Gate | Result |
|---|---|
| Acceptance (BL-1007) | **11/11** |
| Properties | **3/3** |
| Stamp-off (BL-1113) | (run with pass if returned) |

## Forward

`git_handoff` to `cleaner`, priority `00`, task
`BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention` (bounce —
close inventory item 1, then return).

By architect.
