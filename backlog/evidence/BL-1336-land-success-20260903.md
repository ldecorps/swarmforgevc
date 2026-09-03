# BL-1336 — LAND SUCCESS, 20260903

Follows `BL-1336-qa-approval-20260903.md` (full independent verification,
APPROVE, `189a44f6de`).

## Same discipline as every land this session

Hand-built the tip-pure commit, each path individually diffed against
`origin/main`. Includes the incidental `bl1323StampOffInvariants` fix this
parcel's commit gate found — the invariant now checks for the absence of a
certified/waived decision rather than a frozen `state: stamp-open` string,
which properly RESOLVES the class of issue tracked as BL-1356 rather than
merely working around it. `docs/reference/Specification.MD` carried two
separate additive insertions (top changelog entry + a new bullet in the
existing BL-935 living section), both added by hand and diffed clean,
matching exactly (81 lines both sides).

Noted, not acted on: `backlog/paused/BL-1356-...yaml` on `origin/main`
already records the same scope observation (a reviewer bouncing BL-1336
on scope could take the bl1323 fix with it) — a specifier-level tracking
concern, not something this QA pass needed to resolve since the parcel
was approved intact.

## Verification (against the final tip-pure tree, before commit)

- Compile: clean.
- `bl1336RouterForkCeiling.test.js`: 6/6.
- `bl1323StampOffInvariants.property.test.js`: 3/3.
- Acceptance
  (`specs/features/BL-1336-router-rotation-raises-the-vitest-fork-ceiling.feature`):
  6/6.
- Full diff against `origin/main` verified to match the intended 17-file
  own-paths list exactly before pushing.

## Landed

- Tip-pure commit `f7940bdd9f` pushed to `origin/main`
  (`3908babe98..f7940bdd9f`), after a bounded rematch: `origin/main` had
  advanced by unrelated bookkeeping commits between building the commit
  and pushing; diffed clean of any BL-1336 file overlap, cherry-picked
  (`-x`) onto the new tip, content verified byte-identical, pushed.
- `swarmforge-QA` merged up to `f7940bdd9f` at `0cc85e5dfb`. One additive
  conflict resolved (`specs/pipeline/steps/index.js`, both sides' require
  lines kept).
- `abandoned_commits: [189a44f6de]` recorded on the ticket YAML.

By QA.
