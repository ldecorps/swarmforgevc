# BL-1129 — hardener pass — 2026-08-25

Architect tip: `b64460b8eb`. Recreated `swarmforge-hardender` on tip.
Authorize **BL-1129 paths** only.

## Gates

| Check | Result |
|---|---|
| Acceptance | **2/2** |
| `babysitterd_sweep_lib_test_runner.bb` | **ok** |
| `babysitterd_sweep_lib_property_runner.bb` | **ok** |
| Soft Gherkin | **N/A** (no Scenario Outline) |
| Surgical | **2/2 killed** (drop `rotation-router?` gate; invert gate) |

Declared invariants: none (architect). Property runner still green for rotating shape.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1129-babysitter-rotate-not-honored-skips-standing`, commit = this tip.

By hardener.
