# BL-1252 — documenter pass, 2026-08-31

Received via coordinator's `merge_and_process` note (`5d98b62cc5`), which
routed the released ticket straight to documenter per the coder's no-op
evidence (`BL-1252-coder-noop-20260831.md`): the functional commit
(`76dd67b692`, `run_commit_guards.sh` two-tier aggregation) and the
cleaner/architect/hardener passes were all already ancestors of this
worktree's HEAD and `origin/main` before this pass began.

## Doc pass

- New how-to: `docs/how-to/BL-1252-commit-guard-chain-reports-every-violation.md`,
  modelled on the BL-1242 sibling (commit-msg-hook aggregation) — explains
  what changed, the cheap/expensive tiering, what the multi-violation
  refusal looks like, and how to clear it.
- Linked from `docs/index.md` in the how-to section, alongside the sibling
  BL-1242/BL-1258 entries.
- `docs/reference/Specification.MD` "Last Updated" changelog gains a new
  top entry for BL-1252 (date bumped in the same commit as the content
  change).
- No diagram update: no node in `docs/diagrams/architecture.mmd` depicts
  the guard chain's internal sequencing (only changelog comments reference
  individual guard scripts), and BL-1252 changes neither the extension
  host/webview boundary, the tmux substrate relationship, nor the
  `.swarmforge/` state layout — the diagram's change-trigger is not fired.

Commit: `75b65e5103` "BL-1252: document the pre-commit guard-chain
aggregation."

## Disposition

Forwarding `git_handoff` to QA, priority `00`, task
`BL-1252-commit-guard-chain-reports-every-violation`.

By documenter.
