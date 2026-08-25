# BL-1081-an-acp-host-in-a-pane-can-drive-one-seat — documenter pass 2 — 20260823

Commit reviewed: `1bb78e6621` (hardener re-verify after architect pass2;
`merge_and_process hardender 1bb78e6621`). Merge into documenter:
`5f148bb01f` (no silent-revert deletions vs either parent).

## Review inventory (Article 4.4)

NONE.

## What this pass checked

Re-read the ticket and the BL-1081 slice on the received tip after the QA
mkdtemp bounce clear + held-ticket disentangle. User-visible surfaces are
unchanged from documenter pass 1 (`05ba98d54a` / evidence
`BL-1081-documenter-pass-20260823.md`):

- `docs/reference/BL-1081-acp-hosted-seat-snapshot.md` — still matches live
  symbols (`acpSnapshotRelPath` / `snapshot-path`, `apply-acp-facts`,
  `menu-check-applies?`, `check-busy-frozen` / `check-acp-seat`,
  `shouldLaunchViaAcpHost` / `acp-hosted-spike-seat?`,
  `write_role_launch_script` vibe → `acp-host-pane.js`, CLI flags).
- `docs/index.md` — reference blurb still accurate.
- `docs/diagrams/architecture.mmd` — `ACPDIR` / vibe write-read edge still
  correct; `swarm-flow.mmd` untouched (no role/handoff change).
- `docs/reference/Specification.MD` — still no ACP surface; no date bump.
- README — no new user-facing command beyond the operator CLI already in the
  reference doc.

Post-pass-1 deltas on this tip are internal (tmpDir migration in
`acpHostPane.test.js`, tip disentangle from held BL-1052/BL-1082,
hardener Stryker re-verify). No doc content change required.

## Forward

Commit this evidence and `git_handoff` to QA, priority `00`, same task name,
naming this commit.

By documenter.
