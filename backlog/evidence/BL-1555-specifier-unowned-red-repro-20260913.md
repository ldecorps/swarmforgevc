# BL-1555 specifier repro of QA's unowned-red note, 2026-09-13 (two files)

- **Trigger**: QA note 2026-09-13 13:54Z from the BL-1485 parcel
  ("unowned-red 3 flaky test:properties files, evidence dfc2a60b23"),
  evidence `backlog/evidence/unowned-red-property-suite-transient-flakes-QA-20260913.md`
  on `swarmforge-QA` (commit `dfc2a60b23`). QA ran the full property lane
  three times; `bl1253TokenOwnershipInvariants` failed in run 2 and
  `bl956PipelineBoardCaptionCapInvariants` in run 1, each once, each green
  alone and in a 3-file batch afterwards. QA classed both flaky and asked the
  specifier to decide. The third file, `bl1272LandedSiblingInvariants`, is
  BL-1556 (`backlog/evidence/BL-1556-specifier-unowned-red-repro-20260913.md`).
- **Tree**: `main` at `ccd3ff6e63` (equal to `origin/main`).
- **Register**: no row for either file; no active/paused/hold ticket names
  either file (`grep -rl` over the three folders, empty).

## bl1253TokenOwnershipInvariants.property.test.js

QA recorded the failing draw: `seed: -1747880424`, counterexample
`["fresh","fresh","fresh","fresh","fresh","fresh"]`. Only one arbitrary in
the file can yield six states with `fresh` at both ends and no dead state
between: `flappingArb` (lines 199-201),

```js
fc.array(fc.constantFrom('fresh', ...DEAD_STATES), { minLength: 4, maxLength: 6 })
  .map((states) => ['fresh', ...states, 'fresh'])
```

whose test ("the token can change hands repeatedly in one process") then
asserts `handovers >= 1`. With every state `fresh` the bridge never takes
the token, so no handover exists and the floor fails - `checkSequence`
itself passes on that input, so the invariant is not violated; the
generator simply did not build the transition the test is named for. The
same file's `recoveryArb` and `takeoverArb` DO construct their transition
(a dead run and a `fresh` are both spliced in by shape); `flappingArb` is
the one arm that hopes.

Reproduced without the bridge, from `extension/`
(`NODE_PATH=$PWD/node_modules node <script>`; script in this file's history):

```js
fc.check(fc.property(flappingArb, (s) => !s.every((x) => x === 'fresh')),
         { seed: -1747880424, numRuns: 24 })
// -> failed=true at run 20 of 24, counterexample [["fresh" x6]]  (QA's exact shape)
// 2000 fresh seeds, 24 runs each: 93 fail  (about 1 run in 21)
```

The arithmetic agrees: a 4-long inner draw is
all-`fresh` with probability 4^-4, and fast-check's shrinker reports the
minimal 4+2 shape QA saw. Latent since BL-1253 landed the file
(`026ae2aa3e`, 2026-08-30).

## bl956PipelineBoardCaptionCapInvariants.property.test.js

QA did not record the failure text. The file is pure (no clock, no
filesystem, no subprocess; `pipelineBoard.ts` injects every instant), runs
in 1.5 s alone, and 12 of 12 specifier runs alone on `main` passed:

```
cd extension
for i in $(seq 1 12); do npx vitest run --config vitest.properties.config.mjs \
  test/bl956PipelineBoardCaptionCapInvariants.property.test.js || echo FAIL; done
```

So the cause is read off the source. Six floors are asserted after sampled
draws; five sit far from their line, one does not:

| floor | draw | rate of a miss (1500 simulated 150-run seeds) |
|---|---|---|
| `hugeTitleBoards >= 30` | 15 titles, each 50% >= 1000 chars | 0 |
| `metaLessRowsSeen >= 30` | ~8 rows x 50% meta-less per board | 0 |
| `parkedOverflowSeen >= 20` | `plainParkedCount` 0..8 vs `PIPELINE_BOARD_PAUSED_MAX` 3 | 0 |
| `epicsOverflowSeen >= 20` | `epicTrackerCount` 0..8 vs `PIPELINE_BOARD_COLLAPSED_EPICS_MAX` 3 | 0 |
| **`gridOverflowSeen >= 20`** | `activeCount` 1..15 vs `PIPELINE_BOARD_GRID_MAX_ROWS` 12 | **4 (min 18, p5 25, median 32)** |

`activeCount` overflows the 12-row grid on 3 of 15 values; 150 uniform
draws give about 30 overflow boards, and about one seed in 370 gives fewer
than 20. That is the only way this file can fail, and it is the BL-1062 /
BL-1553 shape exactly: a floor met by hope. Whether QA's single failure was
this seed or a lane artefact cannot be settled from what was recorded; the
file carries a seed-flake either way. Latent since BL-956 landed the file
(`294d46406a`, 2026-08-19).

## Disposition

One ticket for both files (same class, same remedy, same helper
`extension/test/helpers/reachFloors.js`, one sitting): **BL-1555**. Two
`property` rows in `backlog/standing-reds.tsv` name it; QA removes both in
the land that turns the files green.

By specifier.
