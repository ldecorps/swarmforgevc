# BL-1100 hardener pass — 20260825

**Architect tip:** `7bc45a8e51` (re-verify; impl already on tip)
**QA tip (batch):** `5580aba7e3` (BL-987) — already ancestor of `origin/main`
**Task:** `BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **3 paths**, **0 deletes** (pre-evidence).

## Product surface

Prose gate `is_do_not_promote` remains deleted; auto-pick skips via
structured `is_epic_type` / `is_blocked_status` + `announce_skip` emits
`skip <id> gate=<gate>`. Authorize **BL-1100 paths only**.

## Gates

| Gate | Result |
|------|--------|
| property bl1100 | 2/2 |
| APS BL-1100 feature | 8/8 |
| Soft Gherkin | fail — Outline Example prose typos survived (product correctly ignores prose); not a pass |
| Surgical (6) | killed=6 survived=0 skipped=0 |
| `is_do_not_promote` under scripts | absent (comment only) |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1100 only.
BL-987 QA tip already on main — no product forward.

By hardender.
