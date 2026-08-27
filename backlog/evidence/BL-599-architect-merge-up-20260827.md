# BL-599 — architect merge-up — 20260827

## Inbound

QA note: `BL-599 QA-approved 460fe85978 — merge your branch up to QA's`
(handoff `001642`).

## Action

Full `git merge 460fe85978` skipped — QA tip vs architect tip diverges on
docs/Spec stacking and sibling trend paths (BL-506 class). Tip-pure path:

1. Checkout QA pass / rematch evidence + ticket `abandoned_commits`
2. Clear committed Spec conflict markers; keep BL-599 Last Updated banner
3. Add architecture.mmd BL-599 annotation
4. `-s ours` merge for QA ancestry

Functional intake-balance tip already on architect (steps, how-to, product).

## Result

- Architect tip records QA land `460fe85978` as ancestor
- Spec markers removed; index/how-to/steps already present

By architect.
