# BL-1081-an-acp-host-in-a-pane-can-drive-one-seat — documenter pass — 20260823

Commit reviewed: `e2a96cb7bc` (hardener forward after coder re-fix for QA
bounce D1; `merge_and_process hardender e2a96cb7bc`).

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket and the full BL-1081 slice on the received tip (host,
snapshot, babysitter wiring, `:acp` provider dimension, production launcher
for the `vibe` spike seat, hardener argv/session-parse hardening). Doc
surfaces:

- `docs/reference/BL-1081-acp-hosted-seat-snapshot.md` — refreshed against
  live symbols (`acpSnapshotRelPath` / `snapshot-path`, `apply-acp-facts`,
  `menu-check-applies?`, `check-busy-frozen` / `check-acp-seat`,
  `shouldLaunchViaAcpHost` / `acp-hosted-spike-seat?`,
  `write_role_launch_script`). Added the `acp-host-pane` CLI flag table.
  Corrected the ticket path to `backlog/paused/…` (no longer claim
  `active/`). Removed the stale "not wired into production" posture — the
  launcher now hosts `vibe` behind `extension/out/tools/acp-host-pane.js`.
- `docs/index.md` — reference blurb updated to match (CLI + production
  launcher for the `vibe` spike seat).
- `docs/diagrams/architecture.mmd` — added `.swarmforge/acp/<role>.json`
  (`ACPDIR`) and the vibe-seat write/read edge; pipeline topology in
  `swarm-flow.mmd` unchanged (no role/handoff change).
- `docs/reference/Specification.MD` — no ACP / Agent Client Protocol
  mention; M8 internal-machinery spike, not product-spec surface. No
  content change, so "Last Updated" left alone.
- README — no user-facing command/setting/flow added beyond the operator
  CLI already covered in the reference doc; no README change.

## Forward

Commit this documentation pass and `git_handoff` to QA, priority `00`, same
task name, naming this commit.

By documenter.
