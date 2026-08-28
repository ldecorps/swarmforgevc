# BL-1219 — architect pass, 2026-08-28

Commit reviewed: 35dade9a9b (cleaner, verifying coder fix c9210fe882).

## Architecture
`buildRoleInboxes` (extension/src/watchdog/chaserMonitor.ts) now resolves
through the single shared `mailboxDir`/`mailboxBaseDir` resolver
(swarmState.ts) instead of hand-rolling the worktree-only path shape.
Dependency gate: PASSED, no forbidden edges. Co-change: only expected
siblings; `chaserMonitor.test.js` (9 co-changes, not touched) inspected
directly — its fixtures use `rolesList: ['coder']` with a non-`master`
worktreeName throughout, so it only ever exercises the worktree-role shape,
which this fix explicitly does not change. Not stale.

## Invariants (declared)
1. "Role inbox resolution returns the role's real mailbox for every role in
   roles.tsv, whatever its worktree shape." — Encoded: acceptance feature
   BL-1219-role-inbox-resolution-covers-master-resident-roles.feature,
   scenario "each role resolves to the mailbox its mail is actually
   delivered to" (Outline, both role shapes) plus "the two language
   implementations agree on every seated role" (real handoff-lib/mailbox-dir
   CLI cross-check, per the engineering rule on constants mirrored across a
   language boundary). Non-vacuous, real-fixture-backed.
2. "A newly dead-lettered handoff is visible to the notify sweep regardless
   of whether its owning role is master-resident or worktree-backed." —
   Encoded: scenarios "a dead letter to a master-resident role is seen by
   the notify sweep", "a dead letter to a worktree role is unaffected", "the
   shared root inbox is nobody's mailbox", "an already-announced dead letter
   is not announced twice" (dedup regression guard).

## Verification run
- `npm run compile` (extension/): clean.
- `npx vitest run test/chaserMonitor.test.js test/notifyDeadLettersCli.test.js test/stuckInProcessChase.test.js`: 33/33 pass.
- `run_acceptance.sh` on the BL-1219 feature: 7/7 scenarios pass.

NONE outstanding. Forwarding to hardener.

By architect.
