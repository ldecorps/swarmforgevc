# BL-908 — HELD, not approved: independent QA confirmation of the BL-825 entanglement

**Parcel:** documenter-forwarded commit `e40a462f02`
(`BL-908-bubble-knowledge-screen-backlog-docs-panels-sync-btn-unreachable`),
merged to this commit on `swarmforge-QA`.

**Not a bounce of BL-908.** BL-908's own gates are clean on independent
review: the architect's earlier sync-trigger send-back (see
`BL-908-bubble-knowledge-screen-backlog-docs-panels-architect-bounce-20260817.md`)
is fixed and re-forwarded, the hardener pass closed 6 Gherkin-mutation
survivors in BL-908's own step handler, and the documenter pass covers
BL-908's own deliverable. No defect found in BL-908's own scope.

**This is a hold, per the coordinator's priority-00 note received in this
same inbox** (`00_20260817T004115Z_000417_from_coordinator_to_QA_for_QA.handoff`,
`message: HOLD BL-908 - do not approve, ships ungated BL-825 (see evidence)`),
corroborating the documenter's own finding
(`BL-825-stranded-at-coder-found-in-BL-908-branch-20260817.md`). QA
independently re-verified the underlying facts before honoring the hold:

- `git log --all --oneline --grep="BL-825"` shows exactly one implementation
  commit, `0f4de7bf8` ("BL-825: Bubble UI bundle resolver (slice A)"),
  authored directly on the coder branch — no cleaner, architect, hardener,
  documenter, or QA commit for BL-825 exists on any ref.
- `git merge-base --is-ancestor 0f4de7bf8 e40a462f0` confirms `0f4de7bf8` is
  an ancestor of the commit QA is reviewing — BL-825's code
  (`UiBundleResolver.kt`, `extension/src/bridge/letsTalkUiBundle.ts`,
  `specs/pipeline/steps/bl825BubbleUiBundleResolutionSteps.js`, and their
  tests) is physically present in this worktree right now.
- `backlog/active/BL-825-bubble-remote-ui-bundle-resolution.yaml` still reads
  `status: todo`, `assigned_to: coder` — its own `required_stages: [coder,
  cleaner, architect, hardender, documenter, qa]` have not run against its
  own content, and its `required_wiring` entries
  (`letsTalkRoutes.ts::ui-bundle`, `BridgeClient.kt::resolveUiBundle`) are
  unchecked.

Approving and landing this commit on `main` would ship BL-825's code having
skipped Article 4.1's design review and coverage/CRAP gates for that
ticket — the exact case "An Approval Authorizes Only Its Ticket's Work"
(BL-506) exists to stop. QA is not treating this as BL-908's defect (it
isn't one) and is not bouncing BL-908 for rework.

## Disposition

- **No merge to `main`.** No merge-up broadcast to
  `coder,cleaner,architect,hardender,documenter`. No coordinator
  bookkeeping handoff.
- The inbound task record is being completed (mailbox housekeeping only —
  QA has processed this delivery) without forwarding, mirroring the "every
  item is a spec gap" disposition in Article 4.4: send the note, complete
  the inbound task, do not forward.
- QA is not the routing authority here (Article 1.1: the coordinator tracks
  parcel location and unblocks stalls). QA will resume verification of
  BL-908 once BL-825 has been routed through its own `required_stages`
  (coder's work already exists at `0f4de7bf8`; the remaining stages are
  cleaner → architect → hardener → documenter) and reaches QA on its own
  ticket, or on further coordinator instruction.

By QA.
