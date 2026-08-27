# Non-stage backlog basename collision is proven (BL-752)

## The gap

BL-694's residual-word allowlist excuses a grandfathered ticket **basename**
only under `backlog/(active|paused|hold)/` (`BACKLOG_STAGE_RE`). A same-basename
file under e.g. `backlog/topics/` must **not** inherit that exemption.

BL-694 registered a step handler for that claim ("non-stage path under the
backlog") but Outline 04 never rendered that step text — only "outside the
backlog" and "elsewhere in the tree". The handler was dead; the claim rode on
inspection alone.

## What changed

1. BL-694 Outline 04 gains the missing Examples row so the handler runs.
2. BL-752 acceptance pins a real `backlog/topics/` collision as unexpected,
   keeps the stage-path exemption green, and asserts every registered
   `bl694ResidualAllowlistSteps.js` handler matches ≥1 rendered step (scoped
   to that file — not a repo-wide unreachable-handler gate).
3. BL-694 steps use `defineScoped` so shared phrases like "the scan runs" are
   not stolen by other features.

## Operator note

If you add a residual-allowlist step pattern, make sure some Examples row or
scenario actually renders it — APS only fails missing handlers, not unused
ones. Scenario 03 of BL-752 is the local canary for that file.

Acceptance:
`specs/features/BL-752-residual-allowlist-non-stage-backlog-path-is-tested.feature`

Related: `docs/how-to/BL-694-residual-word-allowlist-survives-stage-moves.md`.
