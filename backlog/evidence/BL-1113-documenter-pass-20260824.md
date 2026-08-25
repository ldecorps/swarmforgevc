# BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off — documenter pass — 20260824

Commit reviewed: `e52f71a654` (hardener forward; `merge_and_process hardender
e52f71a654`). Merge into documenter completed before this docs commit.

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the stamp-off ticket and acceptance feature (four landed behaviours
under review for hotfix `27273f2b0a`). Doc surfaces updated:

- `docs/reference/Specification.MD` — Last Updated + BL-1113 stamp-off entry.
- `docs/how-to/BL-891-master-main-reconcile-sweep.md` — step-0
  `main_sync_status_cli` actions + trip-once deadlock.
- `docs/how-to/BL-698-telegram-cursor-operator-commands.md` — CreatePlan
  Confirm/Reject.
- `docs/how-to/BL-848-certify-an-operator-hotfix.md` — Related pointer to
  BL-1113 (ledger certify still human).
- `docs/diagrams/architecture.mmd` — BL-1113 comment + reconcile edge note.
- `docs/index.md` — BL-698 link (was orphan), BL-891 blurb.
- README — no extension command/setting change; no edit.
- No new mode-directory how-to for the pack itself (classify, don't fill;
  pack contract lives in Spec + pack file).

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit.

By documenter.
