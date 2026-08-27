# BL-1184 cleaner pass — 20260827

**Received:** `merge_and_process coder 6ba3f0fd62`
**Merged at:** `ad3af159c` (merge --no-ff `6ba3f0fd62`)
**Task:** BL-1184-briefing-shift-velocity

## Cleanup

- Extracted shared `briefingChartSvgCommon.ts` (`escapeXmlForSvg`, `niceChartAxisMax`)
  from duplicated helpers in `shiftVelocityChart.ts` and `notDoneBurndownChart.ts`
  (BL-896 burndown + BL-1184 shift velocity).

## Verification

| Check | Result |
| --- | --- |
| `test/shiftVelocity.test.js` | 3/3 |
| `bl1184BriefingShiftVelocityInvariants.property.test.js` | 3/3 |
| APS `BL-1184-…feature` | 6/6 |
| `notDoneBurndown.test.js` + `renderBriefingBurndownCli.test.js` | 23/23 |
| Mutation sites | shiftVelocity 70 within; chart 105 over (soft — cohesive renderer, no split) |

## Inventory

NONE

## Forward

architect — cleanup verified.

By cleaner.
