# BL-1533 specifier repro of QA's unowned-red note, 2026-09-11

- **Trigger**: QA note 2026-09-11 07:02Z from the BL-1518-a parcel
  ("unowned-red: bl604Trend+bl1373PathSetCache property tests, no ticket"),
  evidence `backlog/evidence/BL-1518-QA-unowned-red-20260911.md` on
  `swarmforge-QA` (commit `f88b2f4ed5`).
- **Tree**: `main` at `8a1a02c8a9`.

## Reproduction (in isolation, so host load is ruled out)

```
cd extension
for i in $(seq 1 15); do npx vitest run --config vitest.properties.config.mjs \
  test/bl604TrendAnalysisInvariants.property.test.js || echo FAIL; done
```

| runs | passed | failed | failure text |
|---|---|---|---|
| 15 | 13 | 2 | `reach floor: delta sign down drawn 8 < 10` (run 2), `reach floor: delta sign up drawn 9 < 10` (run 13) |

Same assertion QA saw in the full lane twice ("delta sign up drawn 7 < 10")
and that BL-1354's QA saw on 2026-09-03 ("delta sign down drawn 8 < 10",
`backlog/evidence/BL-1354-qa-approval-20260903.md` line 83, attributed there
to load - wrongly: a fast-check draw does not depend on host load, and the
miss reproduces alone on a host running nothing else of ours).

## Why

Invariant 1 (`extension/test/bl604TrendAnalysisInvariants.property.test.js`
lines ~78-105) counts `coverage.up`/`coverage.down` per RENDERED bullet
inside the length-bucket loop. Only the `many` bucket (2..8 points) renders
any bullet, and it runs `LENGTH_FLOOR = 12` draws of 1..6 series each, so
the sign counts are a uniform sample of roughly 12 x (biased small array
size) x 1/2 - an expectation near the `SIGN_FLOOR = 10` line, with nothing
constructing either sign. BL-1062's own rule for reach floors: "make the
coverage they demand reachable BY CONSTRUCTION rather than sampled." The
length buckets ARE constructed (iterated explicitly); the sign is not.

Latent since BL-604/BL-654 landed the file (`4d8bf05993`, 2026-08-30).
First recorded 2026-09-03 (BL-1354 QA). Owner: BL-1533.
