# BL-1094 — documenter pass — 20260824

Commit reviewed: `5daa51c1ab` (hardener forward). Merge into documenter
completed (debt-park rename set named in the merge message so the
ticket-deletion guard could accept it). Ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (approval lean a: exempt daemon auto-route only) and
coder/cleaner/architect/hardener evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1094 entry.
- `swarmforge/handoff-protocol.md` — Task/Commit Coherence Gate section:
  `SWARMFORGE_DISPATCH_GAP_AUTOROUTE` exemption + refusal log shape.
- `docs/diagrams/architecture.mmd` — BL-1094 comment beside dispatch-gap.
- README / mode how-tos — no new command/setting/UI; no new how-to
  (classify, don't fill). BL-531 PRE_QA_GATE runbook unchanged (different
  refusal path).

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit.

By documenter.
