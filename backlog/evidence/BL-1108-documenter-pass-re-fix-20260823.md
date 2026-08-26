# BL-1108-cursor-seat-readiness-hotfix — documenter pass (QA bounce re-fix) — 20260823

Commit reviewed: `6dc32e5c7e` (hardener forward; `merge_and_process hardender
6dc32e5c7e`). Merge into documenter completed before this docs commit.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the stamp-off ticket and QA bounce D1 (Claude RC-off ensure must
stay HEALTHY; non-Claude stays OFF). Doc surfaces updated for the
agent-aware `rc-absent-report` contract:

- `docs/how-to/BL-514-remote-control-health-and-ensure-wiring.md` — absent-flag
  short-circuit split Claude HEALTHY vs non-Claude OFF; example annotated.
- `docs/how-to/BL-611-babysitterd-runbook.md` — check 2 footnote matches ensure.
- `docs/how-to/BL-1079-cursor-identity-steward-certify-and-residuals.md` —
  Cursor heal residual + related table.
- `docs/reference/Specification.MD` — Last Updated + corrected BL-1108 entry.
- `docs/diagrams/architecture.mmd` — BL-1108 comment agent-aware.
- `docs/index.md` — BL-514 blurb.
- README — no user-facing extension command/setting/flow; no change.
- No new mode-directory how-to (classify, don't fill).

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit.

By documenter.
