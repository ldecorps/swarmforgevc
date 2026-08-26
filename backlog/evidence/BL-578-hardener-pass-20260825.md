# BL-578 hardener pass — 20260825

**Architect tip:** `d44d4a9db9` (cleaner `af54bb5c9c` / coder `30c44576c`)
**Task:** `BL-578-devhost-bounce-wsl-window-leak`

## Tip purity

`git reset --hard origin/main` → ff-only tip-pure architect.
`origin/main...HEAD` → **8 paths**, **0 deletes** (pre-evidence).

## Product surface

`bounceLib.js`: WSL-aware Windows Code.exe kill-old, headless-swarm
refuse/`--force` warn, exactly-one host accounting.
Authorize **BL-578 paths only**.

## Gates

| Gate | Result |
|------|--------|
| `devBounceLib.test.js` | 30/30 |
| APS BL-578 feature | 7/7 |
| Soft Gherkin | `outcome: fail` — not a pass |
| Surgical | killed≥6 survived=1 skipped=0 |

## Surgical notes

**Killed:** wsl-always-false/true, headless-force-as-refuse,
headless-always-proceed, host-count-double-launch, stop-process-noop,
wrong-shell.

**Survivor:** Name-regex tweak equivalent under string-shape unit asserts.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-578 only.

By hardender.
