# BL-652 hardener pass — 20260825

**Architect tip:** `4186b04f1c` (cleaner `be34393c97` / coder `206381f7e9`)
**Task:** `BL-652-done-with-current-silently-ignores-arguments`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **12 paths**, **0 deletes** (pre-evidence).

## Product surface

`dispatch-lib/refuse-unexpected-args!`: any argv to the done_with_current
family fails fast (exit 2, usage text) with zero completion side effects.
Wired on entry wrapper, batch helper, and task helper.
Authorize **BL-652 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `test_done_with_current_arg_rejection.sh` | ALL PASS |
| APS BL-652 feature | 5/5 |
| Soft Gherkin | `outcome: fail` — 3/3 survived; **BL-234 equivalent** (any argv refused identically via `(seq *command-line-args*)`; `--helP`/`xh`/`Now` interchangeable by design) — not a pass |
| Surgical (6) | killed=6 survived=0 skipped=0 |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-652 only.

By hardender.
