# BL-1137 architect pass — 2026-08-25

## Verdict
**PASS** → hardender.

## Cleaner tip
`68cfb20c9b` (coder `5d72a40e0c`)

## Acceptance
| Wire / invariant | Result |
|------------------|--------|
| cwd-scoped `git add`/`commit` under project root mutes STAGED | PASS (APS + property runner) |
| argv/`git -C` root still mutes (BL-1134) | PASS |
| foreign-cwd git does not mute this root | PASS |
| durable staged reversion, no signal → still alarms (BL-839) | PASS |
| check never writes | PASS |
| APS step registered | PASS |
| Tip purity `origin/main...tip` | **10 paths**, **0 deletes** |

## Design notes
- Cwd match uses exact root / `root/` prefix (`cwd-under-root?`) — avoids sibling-prefix footgun vs naive starts-with.
- Optional sticky mute / mute `:unknown` while in-flight **deferred** — cwd-aware observation alone covers the acceptance bar; not required to ship.

## Verification
- `master_checkout_drift_lib_test_runner.bb`: ALL TESTS PASSED
- `bl1137_cwd_scoped_mute_property_runner.bb`: ALL PROPERTIES HOLD
- APS feature: **8/8 PASS**
