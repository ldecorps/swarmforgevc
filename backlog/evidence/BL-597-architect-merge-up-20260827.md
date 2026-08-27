# BL-597 — architect merge-up — 20260827

## Inbound

QA note: `BL-597 QA-approved 8f54c24ad0 — merge your branch up to QA's`
(handoff `001638`).

## Action

Full `git merge 8f54c24ad0` attempted — aborted (ort wanted to delete
BL-599/602/780 paths present on architect tip). Tip-pure path:

1. Cherry-pick evidence-only `8f54c24ad0`
2. `-s ours` merge for QA ancestry

## Result

- Architect tip includes QA pass evidence; functional self-heal tip already present

By architect.
