# BL-1436 — coder rework after architect bounce, 2026-09-05

## Bounce addressed

`backlog/evidence/BL-1436-bounce-20260905.md` (architect, commit
`a0bb99b453`): `costFrom`'s new honest-null branch (a nonzero-token
category with no known rate returns `null` for the whole estimate) had
**zero automated test coverage** anywhere - the coder's own non-vacuity
proof for that exact branch was a manual `node -e` probe, never an
assertion in a file the suite gates on. The architect measured this
directly: mutating `return null` to `continue` left every named test
surface (30/30 unit, 6/6 acceptance, the property test's own generator
which never produces `undefined`) green.

## What changed since the bounced commit (`09698f2ee1`)

The entry, the display-name map, and the register removal were already
independently confirmed correct by the architect's own bounce evidence -
unchanged, re-applied identically after the revert. The ONLY addition:

- **`extension/test/pricingTable.test.js`**: two new tests.
  1. `estimateCostUsd returns null for a nonzero cache-creation usage on a
     model with no published cache-creation rate` - asserts
     `PRICING_TABLE['claude-fable-5-1'].cacheCreatePerMTok` is `undefined`
     (the fixture assumption the test rests on, named so a future rate
     addition doesn't leave this test silently vacuous) and that
     `estimateCostUsd` with nonzero `cacheCreationTokens` on that model
     returns `null` - the EXACT assertion the architect's remedy asked
     for, and the exact case their manual mutation exposed.
  2. `estimateCostUsd still prices claude-fable-5-1's other categories
     despite its unpublished cache-creation rate` - the positive
     complement: an unpublished single-field rate must not make the
     whole model read as unpriced.

## Non-vacuity (the architect's own repro, re-run against the fix)

Reproduced the architect's exact mutation (`costFrom`'s `return null` →
`continue`) against the CORRECTED test file: `npx vitest run
test/pricingTable.test.js` now **fails** (1 failed, 31 passed) - the new
test at line 104 catches it directly, printing "Received: 0" where
`null` was expected. Restored; `diff /tmp/pricingTable.ts.bak2
extension/src/metrics/pricingTable.ts` empty; suite back to 32/32.

This closes the bounce's own stated remedy exactly: the same regression
the architect could previously only detect by hand now fails a gated,
automated test.

## Verification (repeated from the original pass, unaffected)

| check | result |
|---|---|
| `npx vitest run test/pricingTable.test.js` | 32/32 (was 30/30; +2 new) |
| `npx vitest run --config vitest.properties.config.mjs test/pricingWindows.property.test.js` | 3/3, unaffected |
| acceptance `BL-1436-....feature` | 6/6 |
| acceptance `BL-627-....feature` | 6/6, unaffected |
| `grep -c pricingTable backlog/standing-reds.tsv` | 0 |

See `backlog/evidence/BL-1436-bounce-20260905.md` for the architect's own
finding and `backlog/evidence/BL-1436-cleaner-20260905.md` (both reverted
by the bounce, both re-landing unchanged in content) for the rest of the
parcel's original disposition.
