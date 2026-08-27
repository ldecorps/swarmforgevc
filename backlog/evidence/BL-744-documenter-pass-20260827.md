# BL-744 — documenter pass — 20260827

## Inbound

Hardener tip `4f3ff5e943`. Merge on `swarmforge-documenter`.

## Living docs

Updated BL-718 how-to module map for extracted bubble-mirror helpers
(`bubbleMirrorTopic.ts`, `bubbleMirrorState.ts`, `bubbleMirrorDelivery.ts`,
`bl744TopicMergeHelpers.test.js`). Added architecture diagram note.

No new user-visible behaviour — topic routing rules unchanged; docs reflect
file layout after CRAP gate fix.

## Pre-QA

Ticket acceptance:
`specs/features/BL-744-bl718-crap-gate-never-run-topic-merge-helpers.feature`
(step handler `bl744Bl718CrapGateTopicMergeHelpersSteps.js`, 3/3 pass).

By documenter.
