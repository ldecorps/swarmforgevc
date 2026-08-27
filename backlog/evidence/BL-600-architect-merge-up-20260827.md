# BL-600 — architect merge-up — 20260827

## Inbound

QA note: `BL-600 QA-approved b79af43266 — merge your branch up to QA's`
(handoff `001650`).

## Action

Full merge skipped (docs conflicts / remote removals vs sibling tips).
Tip-pure path:

1. Checkout QA/docs evidence + how-to + ticket YAML
2. Spec/index/arch overlays (product + steps already on tip)
3. Confirm `trend.ts` does not re-export `humanDecisionLatency`
4. APS 5/5; `-s ours` for QA ancestry

## Result

- Architect tip records QA land `b79af43266` as ancestor

By architect.
