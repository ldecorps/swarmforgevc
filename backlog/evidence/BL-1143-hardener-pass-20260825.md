# BL-1143 hardener pass — cold-swap day-shift to ollama mono — 20260825

**Architect tip:** `9b12e8511e` (cleaner `1e3c1171c0` / coder `f9bc48e92`)
**Task:** `BL-1143-cold-swap-day-shift-ollama-qwen`
**Batch sibling:** BL-989 rematch (same tip-pure root)

## Tip purity

`git reset --hard origin/main` → rematch architect product + BL-1142 dep.
`origin/main...HEAD` authorize **BL-1143** (+ required BL-1142 lineage).
**0 deletes.**

## Product surface

`cold_swap_day_shift_to_ollama_qwen.sh`: verify/execute seams, BL-1142
forbidden-pack reuse, steward `:aligned`|`:no-winner-yet`. Hardening locked
the no-winner-yet allow-list path.

## Gates

| Gate | Result |
|------|--------|
| `cold_swap_day_shift_to_ollama_qwen_test_runner.sh` | ALL PASS (incl. 04) |
| `local_ollama_pack_shape_test_runner.sh` (dep) | ALL PASS |
| APS BL-1143 feature | 3/3 |
| Property `bl1143ColdSwapDayShift.property.test.js` | 1/1 |
| Soft Gherkin | `outcome: inapplicable` — not a pass (BL-638) |
| Surgical (6) | killed=6 survived=0 skipped=0 |
| BL-149 | cold_swap `run` |

## Soft → surgical (BL-638)

Hand surgical over target pack, forbidden invert, align allow-list,
verify short-circuit, day_shift_pack write, evidence qwen_forge claim.

## Commit note (BL-1124)

Property-lane commit may use recovery-only
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` after isolated
`test:properties -- test/bl1143…` (full lane still mutates live role
branches; tip restored from reflog if needed).

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1143 (+ dep).

By hardender.
