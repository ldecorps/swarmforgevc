# BL-1124 hardener pass — canary skip-isolation rematch — 20260825

**Architect tip:** `7ac68a2214` (coder `3ddab12d4f`)
**Task:** `BL-1124-property-suite-fixtures-must-not-mutate-shared-main`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **5 paths**, **0 deletes** (pre-evidence).

## Product surface

Canary spawn paths must not inherit `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD`:
APS `sh(..., { enforcePropertyGuard: true })` deletes the skip; shell runner
05 uses `env -u SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD`. Authorize **BL-1124
paths only**.

## Gates

| Gate | Result |
|------|--------|
| unit runner with SKIP=1 | ALL PASS (incl. 05 canary) |
| APS with SKIP=1 | 4/4 |
| Soft Gherkin | `outcome: inapplicable` — not a pass |
| Surgical (6) | killed=6 survived=0 (env -u drop, ST05 invert, enforce flag drop/typo/never, delete invert) |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1124 only.

By hardender.
