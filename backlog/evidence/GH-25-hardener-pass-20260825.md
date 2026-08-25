# GH-25 hardener pass — 20260825

**Architect tip:** `c4d625c990` (cleaner `df96a5d41a` / coder `c798ead59`)
**Task:** `GH-25-email-escalation-for-unanswered-role-questions`

## Tip purity

`git reset --hard origin/main` → ff-only tip-pure architect.
`origin/main...HEAD` → **12 paths**, **0 deletes** (pre-evidence).

## Product surface

`role_ask_escalation_lib.bb` + `operator_runtime.bb` tick: threshold minutes,
one-shot `escalated_at_ms`, GitHub mention, status.json pending/escalated,
missing ops issue → warn. Authorize **GH-25 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `role_ask_escalation_lib_test_runner.bb` | ALL TESTS PASSED |
| `gh25_role_ask_escalation_test_runner.bb` | ALL TESTS PASSED |
| APS GH-25 feature | 8/8 |
| Soft Gherkin | `outcome: fail` (8/16 killed) — not a pass |
| Surgical (6) | killed=6 survived=0 skipped=0 |

## Soft → surgical (BL-638)

Soft survivors expected on Outline edges; hand surgical locked due/stamp/ops/surface.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize GH-25 only.

By hardender.
