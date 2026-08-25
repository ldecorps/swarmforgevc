# BL-1137 hardener pass — 20260825

**Architect tip:** `e00a8487de` (cleaner `68cfb20c9b` / coder `5d72a40e0c`)
**Task:** `BL-1137-master-checkout-drift-mute-misses-cwd-scoped-git`

## Tip purity

Merged onto current `origin/main` (not dirty hardender tip).
`origin/main...HEAD` → **11 paths**, **0 deletes**.

## Product surface

`master_checkout_drift_lib.bb`: cwd-aware `git-add-or-commit-process-for-root?`
via `cwd-under-root?` (exact root / `root/` prefix). Babashka — no
Stryker/CRAP/DRY (degraded fallback). Authorize **BL-1137 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `master_checkout_drift_lib_test_runner.bb` | ALL TESTS PASSED |
| `bl1137_cwd_scoped_mute_property_runner.bb` | ALL PROPERTIES HOLD |
| APS BL-1137 feature | 8/8 |
| Soft Gherkin | inapplicable — not a pass |
| Surgical | killed=8 survived=2 skipped=0 |

## Surgical notes

Killed: drop-cwd-or-branch, cwd-under-always-false, normalize-drop-cwd,
commit-inflight-lock-only, process-always-false, invert-cwd-under,
drop-exact-root-cwd, require-both-argv-and-cwd.

Equivalents under hermetic suite (injected snapshots / no sibling case):
`cwd-sibling-prefix-footgun`, `list-skip-cwd-lookup`.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1137 only.

By hardender.
