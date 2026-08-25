# BL-568 hardener pass — 20260825

**Architect tip:** `39b2ce0227` (cleaner `ec777cf557` / coder `90780bbf1f`)
**Task:** `BL-568-menu-blocked-pane-questions-as-mapped-polls`

## Tip purity

`git reset --hard origin/main` → ff-only tip-pure architect.
`origin/main...HEAD` → **13 paths**, **0 deletes** (pre-evidence).

## Product surface

- `chase_sweep_lib.bb`: detect / extract / poll-surface-plan (caps + fingerprint)
- `telegramClient.ts`: menu-answer mapping + drive plan + text fallback
- Front-desk `roleMenuBlocked` / `menu_blocked` receipt (wired upstream)

Authorize **BL-568 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `bl568_menu_blocked_test_runner.bb` | ALL TESTS PASSED |
| `bl568MenuAnswerPollMapping.test.js` | 4/4 (after `npm run compile`) |
| APS BL-568 feature | 7/7 |
| Soft Gherkin | inapplicable — not a pass |
| Surgical (bb + ts) | killed=10 survived=2 skipped=0 |

## Surgical notes

**Killed (bb):** detect-always-false, options-max-raised, always-poll-skip-cap,
fingerprint-constant, plan-never-poll.

**Killed (ts):** fingerprint-always/never-match, drive-skip-stale-check,
mapping-kind-wrong, fallback-drop-rc.

**Survivors (equivalent under suite):** `detect-chrome-only` (option chrome
not independently asserted when chrome alone); `drive-empty-as-inject`
(empty-vote path not covered by vitest/APS).

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-568 only.

By hardender.
