# BL-1336 — documenter pass, 2026-09-03

Merged hardener commit `a8c1e03c57` (merge commit `1656e62863` — one
additive conflict in `specs/pipeline/steps/index.js`, both sides adding a
different `require(...)` line; resolved by keeping both).

## Doc review

- Diff scoped to `extension/src/tools/vitest-worker-memory-budget.ts` and
  `swarmforge/scripts/swarmforge.sh` — internal test-tooling concurrency,
  no extension command, setting, or UI surface.
- Diagram check: `architecture.mmd`'s change-trigger is the extension
  host/webview boundary, the tmux substrate relationship, or the
  `.swarmforge/` state layout. This ticket adds an exported env var
  (`SWARMFORGE_ROTATION`) sourced from a value (`ROTATION_MODE`/
  `rotation_value`) already written into `swarm-identity` before this
  ticket — no new state-layout element, no boundary change. No diagram
  edit required.
- This exact mechanism (`resolveVitestForkCeiling`/`resolveVitestWorkerPool`,
  BL-935/BL-961) already has a maintained living-reference block under
  "Bounded test-run memory footprint (BL-422)" in `Specification.MD` — the
  right place for this ticket's addition, matching the existing bullet
  pattern, rather than only a changelog-stack entry that would leave the
  living block describing pre-BL-1336 behavior as if current.

## Action taken

Added a dated changelog entry to `docs/reference/Specification.MD` (commit
`8663183f2e`) plus a new bullet in the existing "Bounded test-run memory
footprint (BL-422)" living section, covering: the router-vs-full-forge
topology distinction, the missing-signal root cause, the
`SWARMFORGE_ROTATION` export sharing one `rotation_signal()` helper with
`swarm-identity` so the two can't disagree, the fixed (not core-derived)
`ROUTER_FORK_CEILING = 10`, evaluation order relative to the
full-forge-on-darwin rule, and that the RAM-derived count stays the
binding minimum regardless. `**Last Updated**` bumped in the same commit.

## Verdict

No documenter-domain defect found. Forwarding to QA.
