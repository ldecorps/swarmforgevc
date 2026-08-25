# BL-1109 — documenter pass — 20260824

Commit reviewed: `73063f6be3` (hardener forward). Merge into documenter
completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (starved motion vs owner-busy; CRIT copy; gather glob)
and hardener evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1109 entry.
- `docs/diagrams/architecture.mmd` — BL-1109 comment.
- `docs/how-to/BL-611-babysitterd-runbook.md` — check 10 row + BL-1109
  section; BL-807 glob note aligned with batch_/nested.

No new how-to (classify, don't fill). No extension command/setting/UI.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`,
task `BL-1109-babysitter-starved-ignores-idle-owner-in-process`.

By documenter.
