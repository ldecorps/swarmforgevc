# BL-732 hardener pass — 20260825

**Architect tip:** `38e5efee28` (cleaner `dc62173208` / coder `7075718109`)
**Task:** `BL-732-bl642-chrome-regex-misses-multiword-role-names`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **7 paths**, **0 deletes** (pre-evidence).

## Product surface

Pane-title chrome filter mirrors `display_name_for_role` (multi-word +
`@` seats). Authorize **BL-732 paths only**.

## Gates

| Gate | Result |
|------|--------|
| vitest needsHumanDetection | 66/66 |
| APS BL-732 feature | 8/8 |
| Soft Gherkin | `outcome: fail` — 6/6 survived; **BL-234 equivalent** (`displayNameForRole` title-cases, so Example role case flips normalize identically) — not a pass |
| Surgical (6) | killed=6 survived=0 skipped=0 |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-732 only.

By hardender.
