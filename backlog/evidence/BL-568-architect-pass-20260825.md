# BL-568 architect pass — 2026-08-25

## Verdict
**PASS** → hardender.

## Cleaner tip
`ec777cf557` (coder `90780bbf1f`)

## Acceptance / wiring
| Item | Result |
|------|--------|
| `chase_sweep_lib` detect/extract/poll-surface-plan | Present; bb runner green |
| `telegramClient` menu-answer mapping + fingerprint drive plan | Present; vitest 4/4 |
| Front-desk `roleMenuBlocked` + `menu_blocked` receipt | Wired |
| APS feature (detect→poll, caps fallback, drive, stale drop, steer suppress, free-text, timeout) | **7/7 PASS** |
| Tip purity `origin/main...tip` | **12 paths**, **0 deletes** |

## Design notes
- Detection is chrome+option based (footer/nav + numbered/checkbox) — matches design lock.
- Poll caps: truncate question/options; >10 options → text fallback (no lying poll).
- Drive drops on fingerprint mismatch; never auto-answers on timeout.
- Sticky/optional extras not in scope.

## Verification
- `bl568_menu_blocked_test_runner.bb`: ALL TESTS PASSED
- `bl568MenuAnswerPollMapping.test.js`: 4/4 PASS
- APS: 7/7 PASS
