# BL-1096 — documenter pass — 20260824

Commit reviewed: `43ecfbac6f` (hardener forward). Merge into documenter
completed; ancestry confirmed.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket (per-path QA-import anchor vs merge tip) and hardener
evidence. Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1096 entry.
- `docs/diagrams/architecture.mmd` — BL-1096 comment.
- `docs/reference/BL-632-commit-time-guard-refuses-pipeline-code-on-main.md`
  — merge-import exemption section updated for per-path provenance.

No new how-to (classify, don't fill). No extension command/setting/UI.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`,
task `BL-1096-qa-import-exemption-anchors-per-path-not-the-merge-tip`.

By documenter.
