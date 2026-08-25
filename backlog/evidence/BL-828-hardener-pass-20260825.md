# BL-828 hardener pass — 20260825

**Architect tip:** `5d108adf99` (cleaner `43e958ee06` / coder `ee0f88f74`)
**Task:** `BL-828-bubble-collapsed-gesture-model`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **10 paths**, **0 deletes** (pre-evidence).

## Product surface

Pure `BubbleGestureDecider`: idle tap deferred one double-tap window;
double-tap expands; recording tap sends immediately; drag never a tap.
Authorize **BL-828 paths only**.

## Gates

| Gate | Result |
|------|--------|
| APS BL-828 (JVM suite via Outline) | 8/8 |
| Soft Gherkin | killed=8 survived=0 outcome=pass |
| Surgical (6 on Kotlin) | killed=6 survived=0 skipped=0 |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-828 only.

By hardender.
