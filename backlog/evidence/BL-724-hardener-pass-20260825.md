# BL-724 hardener pass — 20260825

**Architect tip:** `aae86304af` (cleaner `648beab45b` / coder `46fceb651`)
**Task:** `BL-724-orphan-red-shell-test-untracked-and-undiscovered`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **9 paths**, **0 deletes** (pre-evidence).

## Product surface

`shell_test_discovery_lib.bb` + CLI + `test_shell_test_discovery.sh`:
every `test_*.sh` is reached, excluded-with-reason, or loud failure
(untracked/unaccounted). Authorize **BL-724 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `test_shell_test_discovery.sh` | ALL PASS |
| APS BL-724 feature | 8/8 |
| Soft Gherkin | not relied on this pass (prior soft hangs); surgical used |
| Surgical | killed=5 survived=1 skipped=0 |

## Surgical notes

**Killed:** drop-orphan-probs, orphan-empty, account-else-reached,
untracked-always-empty, no-relabel.

**Survivor:** `account-untracked-as-reached` (label helper; loud failure
still comes from `check-discovery` orphan strings).

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-724 only.

By hardender.
