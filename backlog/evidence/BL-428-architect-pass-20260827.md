# BL-428 — architect pass (paneHistory decrap slice) — 20260827

**Tip:** coder `742f2d2902` (scoped paths) + cleaner `279bf406eb`
**Handoff:** `00_20260827T103924Z_001009_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Architecture

On-touch decrap slice: `detectFooterLineCount` extracted in `paneHistory.ts`
with `panel.js` parity; standing tracker BL-428, no new acceptance contract.

## Verification

| Check | Result |
|-------|--------|
| unit paneHistory | **17/17** |
| unit footerDetectionParity | **11/11** |
| unit footerAwareScroll | **14/14** |
| CRAP (paneHistory.ts) | all **≤6** |

By architect.
