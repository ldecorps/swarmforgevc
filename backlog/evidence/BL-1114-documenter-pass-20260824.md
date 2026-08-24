# BL-1114 — documenter pass — 20260824

Commit reviewed: `03e523bbde` (hardener forward; already ancestor of tip
after BL-1071 batch merge). Docs for this ticket landed in
`84876b7f0b` (Spec + architecture) alongside the BL-1071 re-pass batch.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Exhausted recovery: terminal note + wake + dispose `.dead` to
`handoffs/failed/`. Spec/diagram already updated; no new how-to
(classify, don't fill). No extension command/setting/UI.

## Forward

`git_handoff` to QA, priority `00`, task
`BL-1114-dead-letter-quarantine-must-not-be-silent`, naming this tip.

By documenter.
