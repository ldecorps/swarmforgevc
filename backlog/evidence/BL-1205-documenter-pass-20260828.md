# BL-1205 documenter pass — 2026-08-28

Merged hardener's `df2e274bac` clean (post-bounce re-fix for a fixture
cleanup gap, plus a Gherkin-mutation equivalent survivor correctly ruled
equivalent). One conflict in `specs/pipeline/steps/index.js` — HEAD's
side already carried `bl1213ParcelRollbackGuardSteps` and
`bl1199PackSwitchBubbleTunnelSteps` (duplicates of the incoming side);
kept HEAD's list plus the one genuinely new entry,
`bl1205HandoffRefusesAMassDeletionForwardSteps`.

## BL-1204 riding along, not forwarded separately

This merge also carried a sibling ticket's changes
(`extension/src/tools/telegramCursorBridgeCore.ts`,
`telegramCursorOperatorExec.ts` + tests, BL-1204) via the shared
architect-worktree history — hardener's own evidence flags this
explicitly as "not part of BL-1205's own diff". Checked BL-1204's ticket
file: `status: todo`, `assigned_to: coder` — still mid-pipeline (bounced,
being re-worked), not complete work silently riding a finished handoff.
Per BL-250 this only matters for a ticket that's DONE; an in-flight
sibling is just ambient branch history and gets its own doc pass + QA
handoff when it actually reaches documenter on its own track. No action
taken on it here.

## Documentation

New how-to: `docs/how-to/BL-1205-tree-collapse-guard.md`. New section in
`swarmforge/handoff-protocol.md` right after BL-1213's, alongside the
other send-time gates. Linked from `docs/index.md`. Added a
`Specification.MD` changelog entry at the top, dated 2026-08-28.

Forwarded to QA, task `BL-1205-handoff-refuses-a-mass-deletion-forward`,
tip `aeaa486230`.

By documenter.
