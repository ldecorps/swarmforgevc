# BL-1144 hardener pass — frequent QA push races on main land — 20260825

**Architect tip:** `d6ae31366c` (coder `4a86f69538` / cleaner `e6ad05e8be`)
**Task:** `BL-1144-frequent-qa-push-races-on-main-land`

## Tip purity

Merged architect handoff. Authorize **BL-1144** paths only (reconcile lib +
land script + QA prompt + how-to + APS + hardening). **0 deletes.**

## Product surface

`master_main_reconcile_lib`: publish-time purity (`publish-time-purity-action`,
bounded attempts) + land/close serialize (`land-close-publisher-admission`,
`contention-publish-next`). `land_main_publish.sh` impure wiring (`bb -e`
decide-only, lock acquire/release).

## Gates

| Gate | Result |
|------|--------|
| `master_main_reconcile_lib_test_runner.bb` | ALL TESTS PASS |
| `land_main_publish_test_runner.sh` | ALL PASS (new) |
| APS BL-1144 feature | 3/3 |
| Soft Gherkin | `outcome: inapplicable` — not a pass (BL-638) |
| Surgical (9) | killed=9 survived=0 skipped=0 |
| BL-149 | reconcile lib `skip-cooldown`; land script `run` |

## Soft → surgical (BL-638)

Lib: max-attempts, peer lock, conflict refuse, lock admit, contention
compose, origin-advanced. Land: `bb -e`, tip-contains-origin, lock-free
detection (02b held-lock path added to kill survivor).

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1144.

By hardender.
