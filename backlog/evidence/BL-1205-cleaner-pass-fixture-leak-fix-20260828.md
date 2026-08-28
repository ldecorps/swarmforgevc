# BL-1205 cleaner pass (fixture-leak re-fix) — 2026-08-28

Merged coder handoff `0a43319fd3` (architect bounce D1 re-fix: the
acceptance step handler's `ctx.root` fixture git repo was never cleaned
up). Clean merge, no conflicts.

## Review
`cleanupFixtureState(ctx)` is called from a `finally` at all four terminal
`Then` steps, idempotent (checks `ctx.root` truthy, sets it `undefined`
after `rmSync`), matching BL-971's "removed in a finally, never only after
the last assertion" guardrail. Traced each of the file's 5 scenarios to
confirm every one reaches a step with the cleanup call and that no step
after a cleanup call still needs fs access to `ctx.root` — confirmed:
later steps (`path-count assertion`, `warning names the branch`) only
inspect the already-captured `ctx.result` string output. No duplication,
no structural issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- Ran the feature's real acceptance pipeline directly
  (`specs/pipeline/runnerAdapter.js` against
  `specs/features/BL-1205-handoff-refuses-a-mass-deletion-forward.feature`):
  9/9 scenarios pass.
- `ls /tmp | grep bl1205-tree-collapse` after the run: 0 matches — no
  leaked fixture directories, confirming coder's own verification
  independently.

By cleaner.
