# BL-1106 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `e74f01e1ac` (BL-1106: resolve pause and throttle at the
master checkout) into `swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor e74f01e1ac HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/backlog_depth_test_runner.bb`:
   ALL PASS.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1106-a-pause-is-visible-from-every-checkout.feature`:
   7/7 pass (checkout matrix + worktree promote-while-paused).

Property suite not run (cleaner does not own property tests). CRAP/mutation/DRY
tooling not wired for `.bb` — degraded gate is the unit suite. Mutation-site
count N/A (no TS `src/` in the coder tip).

## Cleanup performed

- Extracted private `master-runtime-path` so `throttle-recommendation-path`
  and `pause-marker-path` share one resolve-at-master call site (BL-1106
  invariant 1 / BL-966), instead of duplicating
  `(apply fs/path (resolve-identity-root …) …)`. Behavior unchanged.

## Findings beyond that

NONE. Coder's fix correctly reuses the existing memoized
`resolve-identity-root` rather than inventing a second normalizer.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1106-a-pause-is-visible-from-every-checkout`.

By cleaner.
