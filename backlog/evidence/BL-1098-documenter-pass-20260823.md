# BL-1098-silent-revert-of-landed-content — documenter pass — 20260823

Commit reviewed: `58da5edacb` (hardener forward; `merge_and_process hardender
58da5edacb`).

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket and the silent-revert gate on the received tip
(`silent-revert-path?` / `silent-revert-decision` in `push_sweep_lib.bb`,
`:silent-revert-gate-facts!` in `handoffd.bb`, sibling of BL-855's
noop-landing-merge gate on the same `push-sweep!` path). Doc surfaces:

- `docs/reference/Specification.MD` — new push-sweep entry after BL-855
  documenting the silent-revert refusal (git-objects-only verdict, tip-match
  never flagged, merge-touched-path cost bound, refusal names path +
  authoring commit + divergence merge, reason `:silent-revert`). Last Updated
  bumped in the same commit. Short changelog mention beside the existing
  BL-855 note.
- `docs/diagrams/architecture.mmd` — push-sweep comment and DAEMONDIR edge
  now name BL-1098 beside BL-855/BL-630.
- `docs/index.md` — Spec already linked; no new mode-directory doc minted
  (classify, don't fill — this is an internal push-sweep gate sibling of
  BL-855, which also lives in Spec + architecture rather than its own
  how-to).
- README — no user-facing command/setting/flow; no change.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit.

By documenter.
