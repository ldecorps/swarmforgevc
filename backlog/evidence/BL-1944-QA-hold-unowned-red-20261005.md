# BL-1944 QA hold: unowned red (2026-10-05)

parcel: c6a65323ed
red: extension/test/bl1232ShiftVelocityChartInvariants.property.test.js

Failing command (qa-gather properties row, one run): `npm run test:properties` from extension/ at c6a65323ed.
Verbatim:
```
FAIL  test/bl1232ShiftVelocityChartInvariants.property.test.js > BL-1232 invariant 2: the picker never anchors two labels inside the gap > clears the gap on clustered layouts where index-thirds would not
Error: reach floor: layouts index-thirds would crowd discriminating drawn 39 < 40
 ❯ test/bl1232ShiftVelocityChartInvariants.property.test.js:202:5
```
(Also present: the allowlisted BL-871 `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled errors.)

The parcel did not touch this file (diff: four new specs/pipeline/steps handlers + BL-1944 evidence). Register join: absent - no standing-reds.tsv row. Candidate owner: BL-1583 (paused epic, sampled reach floors constructed); its census `backlog/evidence/BL-1583-sampled-reach-floor-census-20260915.md` line 169 lists this file at floor 40 / sampled 31-99, but it holds no register row and is not active.

Everything else for BL-1944 at c6a65323ed is green: BL-111 3/3, BL-112 3/3, BL-544 2/2, BL-661 5/5; diff scope per qa_e2e step 5; unit, wiring, sibling, register, acceptance rows exit 0. The BL-754 red the coder reported is owned (hotfix dfa78c6ead, BL-2006).
Parcel waits for an owner (Article 4.2); on release, re-run the gate on c6a65323ed.
