# Unowned red: bl871PropertyLaneWorkerPoolCapInvariants invariant 1, found while verifying BL-2044

Not BL-2044's own defect: `swarmforge/scripts/parcel_line_lib.bb`,
`specs/pipeline/steps/bl2044SeatCommitsSurviveLineMoveSteps.js` and
`swarmforge/scripts/test/bl2044_seat_commits_survive_line_move_property_runner.bb`
(BL-2044's whole touched set) have nothing to do with worker-pool sizing.

`npm run test:properties` (full 525-file lane, ~1090s wall) failed one file:

```
❯ test/bl871PropertyLaneWorkerPoolCapInvariants.property.test.js (2 tests | 1 failed)
  × property (BL-871 invariant 1): a file's worker-process ceiling (heap and
    concurrency) stays fixed no matter how many property files run alongside it
    → Property failed after 3 tests
    { seed: 1248048417, path: "2", endOnFailure: true }
    Counterexample: [4]
```

Isolated re-run, same worktree, same commit:

```
npx vitest run --config vitest.properties.config.mjs \
  test/bl871PropertyLaneWorkerPoolCapInvariants.property.test.js
 ✓ test/bl871PropertyLaneWorkerPoolCapInvariants.property.test.js (2 tests) 13802ms
```

Passes alone, fails only under the full concurrent lane - a host-load-
sensitive flake in the same family as
`backlog/evidence/BL-871-standing-red-scenarios-02-03-04-20260919.md`
(scenarios 02-04 of this same ticket's acceptance feature, also host-load-
sensitive, also pre-existing). `backlog/standing-reds.tsv` carries no row
for this file or for BL-871. No open ticket found for it
(`grep -r bl871 backlog/` turns up only the 2026-09-19 evidence file and
BL-871's own closed ticket/evidence from 2026-08-11).

The other 524 files passed; the 5 "Unhandled Error" entries in the same
run are all `[vitest-worker]: Timeout calling "onTaskUpdate"`, the
allowlisted BL-871 benign error (engineering.prompt).

By coder.
