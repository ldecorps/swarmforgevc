# BL-1553 specifier repro of QA's unowned-red note, 2026-09-13

- **Trigger**: QA note 2026-09-13 10:25Z from the BL-1499 parcel
  ("unowned-red: bl1364TurnProfileSeriesInvariants flake - see BL-1499 QA
  note"), evidence `backlog/evidence/BL-1499-QA-unowned-red-20260913.md` on
  `swarmforge-QA` (commit `1ad3cf5cd6`).
- **Tree**: `main` at `fdb19b9bf0`.

## What QA saw

Full property lane, two clean sequential runs (no other vitest/stryker
process): `test/bl1364TurnProfileSeriesInvariants.property.test.js` >
`property (invariant 2): one damaged transcript refuses the whole window`
failed with

```
AssertionError: never generated an unreadable path: {"interior":6,"missing":9,"unreadablePath":0}
```

at line 193. Re-run alone 10 times on a quiet host: **1 of 10 failed**,
same assertion, same shape (`unreadablePath` 0).

## Specifier reproduction (in isolation)

```
cd extension
for i in $(seq 1 12); do npx vitest run --config vitest.properties.config.mjs \
  test/bl1364TurnProfileSeriesInvariants.property.test.js || echo FAIL; done
```

| who | tree | runs | failed |
|---|---|---|---|
| QA, 2026-09-13 | BL-1499 parcel, full lane | 2 | 2 |
| QA, 2026-09-13 | BL-1499 parcel, alone | 10 | 1 |
| specifier, 2026-09-13 | main `fdb19b9bf0`, alone | 12 | 0 |

The specifier's 12 clean runs do not contradict QA's 1 in 10: the miss
is a seed event, and the assertion text QA quotes cannot be produced any
other way. It is read straight off the test:

## Why

Invariant 2 (`extension/test/bl1364TurnProfileSeriesInvariants.property.test.js`
lines 139-194) draws `brokenKind` with `fc.integer({ min: 0, max: 2 })`
inside `fc.property`, runs `numRuns: 15`, counts each kind in `seen`, and
then asserts all three of `interior`, `missing`, `unreadablePath` reached
at least 1. Nothing constructs any kind: a uniform draw misses one of three
values in 15 tries about 0.7% of the time, and fast-check's boundary bias
on small integer ranges moves that figure up, which is why the miss lands
on `unreadablePath` (the `max`) and QA measured roughly one in ten. Same
shape BL-1533 owns in `bl604TrendAnalysisInvariants` (the delta sign was
sampled while the length bucket was iterated) and BL-1062's rule names:
a reach floor is met BY CONSTRUCTION, never by a draw the floor hopes
covers it. Invariant 1's two floors (`someUnworked`, `multiWorked`) are
also sampled but sit far from their line (`uniqueArray` of at most 4 of 7
stages cannot work every stage, and 25 draws of length 1..4 miss
`multiWorked` only if every draw has length 1); they are named here so
the coder can construct them in the same pass if cheap, but they have not
been seen to miss.

Latent since BL-1364 landed the file (2026-09-05). First recorded
2026-09-13 (BL-1499 QA). Owner: BL-1553.

## Also seen in the same QA evidence, not minted

`test/bl1272LandedSiblingInvariants.property.test.js` invariant 1 timed
out at 20 s in the full lane only and passes alone in 10.9 s; QA did not
ask for a ticket and it is not registered. It is BL-871's known
contention shape until it fails alone.

By specifier.
