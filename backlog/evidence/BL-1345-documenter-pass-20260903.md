# BL-1345 — documenter pass, 2026-09-03

Merged hardener commit `990f00a572` — clean merge, no conflict.

## Doc review

- Diff scoped to `swarmforge/scripts/babysitter_check.bb`,
  `swarmforge/scripts/remote_control_health_lib.bb`, and
  `swarmforge/scripts/swarm_ensure.bb` — internal health/staffing machinery,
  no extension command, setting, or UI surface, but directly continues a
  mechanism (`.swarmforge/mono-router-active-role` consumer gating,
  BL-1020) that already has two maintained how-to docs.
- `docs/how-to/BL-1020-stale-mono-router-marker-is-not-topology.md` named
  only "Attach and relaunch_resume_cli.bb" as `resolve-resident-role`'s
  callers — stale as of the RC-repair hotfix `195de28861` (a third caller)
  and now BL-1345 (a fourth, `babysitter_check.bb`). Added both, plus a new
  "When a consumer gets this wrong anyway" section narrating the
  2026-09-02 incident this ticket closes the remainder of, and an
  acceptance cross-link. Committed with an untagged subject (task-scope
  gate, BL-1192 — basename names BL-1020, not BL-1345).
- `docs/how-to/BL-514-remote-control-health-and-ensure-wiring.md` is the
  primary living reference for `remote_control_health_lib.bb`'s
  classification behavior and had no mention of the new
  `assigned-role-mismatch` check at all. Added a new subsection in the
  same style as the existing BL-898 `:session-dead` subsection, describing
  the incident, the check's inputs, its three silent cases, and where it's
  wired. Committed with an untagged subject (same gate, basename names
  BL-514).
- Checked `docs/how-to/BL-611-babysitterd-runbook.md` (the CRIT-row
  reference for `babysitter_check.bb`): it describes CRIT rows at a level
  above the internal `resident-active-role`/mailbox/dispatch-note
  derivation this ticket fixed, and made no claim this ticket falsifies.
  No edit needed.
- Diagram check: `architecture.mmd`'s change-trigger is the extension
  host/webview boundary, the tmux substrate relationship, or the
  `.swarmforge/` state layout. This ticket changes which code paths
  correctly GATE an existing state file, not the file's shape or location.
  No diagram edit required.

## Action taken

Added a dated entry to `docs/reference/Specification.MD` (commit
`ff827f9ab0`) covering both halves: the babysitter's third-consumer gate
(routed through the shared `resolve-resident-role` decision, folded
through the pack's own role list per invariant 3) and the new
`assigned-role-mismatch` recheck (the fix that would have caught the
actual incident), plus the architect bounce and its D1 rework.
`**Last Updated**` bumped in the same commit.

## Verdict

No documenter-domain defect found in this ticket's own diff; two
pre-existing stale how-to docs found and updated (BL-1020, BL-514, above).
Forwarding to QA.
