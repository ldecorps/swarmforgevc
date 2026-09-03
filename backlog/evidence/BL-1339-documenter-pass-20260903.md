# BL-1339 — documenter pass, 2026-09-03

Merged hardener commit `c080dcc31b` (merge commit `753d443967` — one
additive conflict in `specs/pipeline/steps/index.js`, both sides adding a
different `require(...)` line; resolved by keeping both).

## Doc review

- Diff scoped to `swarmforge/scripts/land_step_lib.bb` (new
  `shared-target-root`/`append-land-approval!`) and
  `swarmforge/scripts/is_qa_ancestor.sh` (land-store resolution) — an
  internal root-resolution correctness fix, no extension command, setting,
  or UI surface.
- Checked `docs/reference/BL-632-commit-time-guard-refuses-pipeline-code-on-main.md`
  (linked from BL-1334's own Specification.MD entry, "the predicate's
  now-updated full definition"): it describes the land-approval store's
  existence and semantics (a record maps a replayed commit to its approved
  source; approval doesn't chain) but never states which root the store is
  resolved from — that detail lives one layer beneath what this doc
  documents. BL-1339 changes the resolution mechanism, not the semantics,
  so nothing there went stale. No edit made.
- Diagram check: `architecture.mmd`'s change-trigger is the extension
  host/webview boundary, the tmux substrate relationship, or the
  `.swarmforge/` state layout. The land-approval store's location and
  shape are unchanged — only which physical root the same relative path
  resolves against. No diagram edit required.

## Action taken

Added a dated entry to `docs/reference/Specification.MD` (commit
`d1f82c6d5e`) covering: the root-mismatch mechanism (writer resolved the
QA worktree, every reader resolved the target root), the fix
(`shared-target-root` via `git-common-dir`'s parent, reused on both the
write and is_qa_ancestor.sh read sides per the human's ruling), the
fail-closed behavior on an unresolvable root (invariant 3), why six prior
pipeline stages went green over this defect (single-root test fixtures),
and that the bounce-store blind spot the investigation also found stays
open by design (its own future ticket). `**Last Updated**` bumped in the
same commit.

## Verdict

No documenter-domain defect found. Forwarding to QA.
