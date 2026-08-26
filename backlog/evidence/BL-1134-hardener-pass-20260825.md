# BL-1134 hardener pass — 20260825

**Architect tip:** `607e0722d8` (merged as `e53f6817e`)
**Task:** `BL-1134-master-checkout-drift-mute-covers-post-add-window`

## Product surface

`master_checkout_drift_lib.bb`: widen `commit-in-flight?` beyond
`.git/index.lock` to live `git add`/`git commit` argv naming this root
(`git-add-or-commit-argv-for-root?` + shared `process_table_lib`).
Babashka — no Stryker/CRAP/DRY (Engineering Rules degraded fallback).

## Gates

| Gate | Result |
|------|--------|
| `master_checkout_drift_lib_test_runner.bb` | ALL TESTS PASSED |
| `bl1134_post_add_mute_property_runner.bb` | ALL PROPERTIES HOLD (I1–I4 + vacuity control) |
| APS `BL-1134-master-checkout-drift-mute-covers-post-add-window.feature` | 6/6 passed |
| Soft Gherkin | `outcome: inapplicable` (no Scenario Outline) — not a pass |
| Standing step guards (tmuxReaper / bl968 / bl643) | green |

## Soft Gherkin → surgical (BL-638)

Plain Scenarios only. Hand-authored mutants on
`master_checkout_drift_lib.bb` (restored after each):

| Mutant | Verdict |
|--------|---------|
| drop-root-includes | killed |
| drop-argv-re | killed |
| regex-add-only | killed (re-anchored after first skip) |
| regex-commit-only | killed |
| lock-only-in-flight (BL-1122 regress) | killed |
| argv-only-in-flight | killed |
| always-mute-when-inflight | killed |
| should-alarm-always-false | killed |
| drop-or-empty-process-table `(or nil [])` | **equivalent** — `(mapv f nil)` ≡ `(mapv f [])` in Clojure/bb; probe `with-redefs list-processes!→nil` returns `false` both with and without `or` (2026-08-25). Not forced trivia. |

`mutants: killed=8 survived=0 skipped=0` (1 accepted equivalent recorded).

## Forward

`git_handoff` to `documenter`, priority `00`, same task name.
Authorize BL-1134 paths only.

By hardender.
