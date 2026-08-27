# BL-738 — architect merge-up — 20260827

## Inbound

QA note: `BL-738 QA-approved 401048f0f6 — merge your branch up to QA's`
(handoff `001622`).

## Action

`git merge 401048f0f6` — ort merge with one conflict in
`specs/pipeline/steps/index.js` (duplicate `bl738ChunkingPropertySteps`
registration). Kept the QA-side placement (single require later in the list);
dropped the early HEAD duplicate.

## Result

- Architect tip includes QA land `401048f0f6`
- `bl738ChunkingPropertySteps` registered once

By architect.
