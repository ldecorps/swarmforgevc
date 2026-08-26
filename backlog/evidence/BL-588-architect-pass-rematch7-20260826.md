# BL-588 — architect pass — 20260826 (rematch 7)

- merge_and_process cleaner tip `2bdb4c902d` (conflicts resolved in ticket YAML +
  feature mutation stamps; tree **8859** paths).
- Addresses QA scrub bounce D1: cleaner re-cut from `origin/main` is BL-588-only
  (26 paths vs main — no BL-653/660/INTAKE). Prior hitchhiker-scrub commits
  abandoned per ticket `abandoned_commits` list.
- Architect branch still carries independently-passed BL-653/660 slices; verified
  present at HEAD (not deleted by this rematch).

## Architecture / boundaries

- Pure `batchRecovery.ts` core; IO at CLI edge.
- BL-532 deferral consumption; approach 3 invariants unchanged.
- Hardender mutation stamp on feature file retained from prior pass.
- Dependency gate: **PASSED**.

## Verification

- Unit: 16/16 vitest green.
- Property: 3/3 green (vitest globals, no `node:test` import).

Pass → hardender.

By architect.
