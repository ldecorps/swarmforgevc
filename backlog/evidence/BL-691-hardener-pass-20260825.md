# BL-691 hardener pass — 20260825

**Architect tip:** `adebeca334` (cleaner `a5ba217074` / coder `ae97c35c9`)
**Task:** `BL-691-ambulance-mode-workflow-gaps-from-bl688-live-run`

## Tip purity

`git reset --hard origin/main` → ff-only tip-pure architect.
`origin/main...HEAD` → **19 paths**, **0 deletes** (pre-evidence).

## Gaps covered

| ID | Surface |
|----|---------|
| D1 | `parcel-held?` consulted on deliver / news paths |
| D2 | `chase-rotate-to!` / decide-rotate `:ignore-busy?` for patient mail |
| D3 | CLI + Telegram engage refuse non-`active/` (names folder) |

Authorize **BL-691 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `bl691_ambulance_gaps_test_runner.bb` | ALL TESTS PASSED |
| `ambulance_lib_test_runner.bb` | ALL PASS |
| `bl691AmbulanceEngageActiveOnly.test.js` | 2/2 (after compile) |
| APS BL-691 feature | 13/13 |
| Soft Gherkin | **pass** |
| Surgical (D1–D3) | killed≥9 (incl. cli + tg folder checks) |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-691 only.

By hardender.
