# BL-668 — architect merge-up — 20260827

## Inbound

QA note: `BL-668 QA-approved a764fe488d — merge your branch up to QA's`
(handoff `001605`).

## Action

`git merge --no-ff a764fe488d` onto architect tip.

- Resolved `specs/pipeline/steps/index.js` conflict: kept architect
  `bl780`/`bl781` step registrations; took QA tip for the rest.
- Named deliberate retirements of paused `BL-1161` and paused-duplicate
  `BL-759` (done/M8 BL-759 retained) so the ticket-delete commit hook passed.

## Result

- Tip: `ac4c97405`
- `a764fe488d` is ancestor of HEAD.

By architect.
