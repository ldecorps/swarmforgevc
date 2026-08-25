# BL-1129 — architect pass — 20260825

**Tip:** cleaner `59e8d5fafb` (coder `d950ca8d2`)
**Handoff:** `50_20260825T124500Z_000803_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...59e8d5fafb` = **9 paths**, BL-1129-only. Hitchhike CLEAN.

## Architecture

- `check-rotate-not-honored` gated on existing BL-804 `rotation-router?`
  (same topology flag as resident-stranded) — suppress on standing, keep
  CRIT on rotating/mono-router.
- Sweep threads `:rotation-router?` into the check; no parallel topology
  detector. Integrate-not-fork. Dep-gate N/A (Babashka).

## Invariants

None declared — property-test obligation is a no-op. Existing property
runner updated so rotate cases set `:rotation-router? true` (rotating
shape). Unit asserts standing (`false`) suppresses.

## Correctness

- APS → **2/2**
- `babysitterd_sweep_lib_test_runner.bb` → ok
- `babysitterd_sweep_lib_property_runner.bb` → ok

No defect spotted.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1129-babysitter-rotate-not-honored-skips-standing`, commit = this tip.
Authorize BL-1129 paths only.

By architect.
