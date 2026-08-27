# BL-601 — architect merge-up — 20260827

## Inbound

QA note: `BL-601 QA-approved 01cc6cc62e — merge your branch up to QA's`
(handoff `001645`).

## Action

Full merge skipped — tip diverges / remote removals vs sibling paths (BL-506).
Tip-pure path:

1. Checkout QA pass / rematch evidence + ticket YAML
2. Land missing how-to + Spec/index/arch overlays (product already on tip)
3. `-s ours` merge for QA ancestry

## Result

- Architect tip records QA land `01cc6cc62e` as ancestor
- Compaction cadence product + docs present; `trend.ts` remains non-re-exporting

By architect.
