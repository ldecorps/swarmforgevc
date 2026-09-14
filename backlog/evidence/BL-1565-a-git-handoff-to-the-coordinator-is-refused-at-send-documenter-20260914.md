# BL-1565-a-git-handoff-to-the-coordinator-is-refused-at-send — documenter review pass, 2026-09-14

NONE. The full checklist was run and found no defect.

Recorded as an explicit NONE rather than skipped: an inventory is a pass
artifact, not only a bounce artifact (Article 4.4), and the forward names
THIS commit rather than the received hash (BL-536).

By documenter.

## Detail

- Re-read the ticket: prose amendments (QA.prompt, coordinator.prompt,
  specifier.prompt, handoff-protocol.md) were already landed by the
  specifier at mint time (b77a29c23b) — this pass confirmed they are in
  place and unchanged (`swarmforge/handoff-protocol.md` lines 273-278
  already read the `note`-only close shape).
- Checked `docs/reference/Specification.MD`, `docs/how-to/`,
  `docs/explanation/`, `docs/tutorials/` for any living doc still
  describing the retired QA-to-coordinator `git_handoff` forward shape.
  Found one accurate pre-existing reference
  (`docs/how-to/BL-1418-the-art-director-seat-is-addressable.md:25`,
  already correct) and one unrelated historical mention
  (`docs/reference/Specification.MD:2469`, about the close guard's
  mailbox-or-expedite-store check, out of this ticket's scope per its own
  "Not in scope" section).
- Diagram currency (this prompt's own gate): `docs/diagrams/handoff-flow.mmd`
  depicts the send-time gate chain (`ROOTGUARD` -> `VALIDATE` -> `WRITE`)
  that this parcel adds a new gate into (`git-handoff-recipient-guard-lib/decide`,
  consulted right after `validate` header-parse and again on the
  post-routing recipient set, both before `AUDIT_REQUIRED`) — its own
  change-trigger ("when the handoff file lifecycle, its gates ... change")
  fired. Added `RECIPIENTGUARD`/`COORDREFUSED` nodes between `VALIDATE` and
  `WRITE`, with a bypass edge for non-`git_handoff` types so `note`/`awake`/
  `rule_proposal` sends are shown unaffected, matching
  `swarm_handoff.bb` lines ~1158-1198 exactly. `docs/diagrams/swarm-flow.mmd`
  needed no change — its `QA -->|notifies: approved commit + task id| COORD`
  edge was already generic (doesn't specify `note` vs `git_handoff`) and
  stays accurate.
  `extension/src/tools/render-briefing-diagrams.ts`'s `DIAGRAM_FILES`
  allowlist still lists `handoff-flow.mmd` unchanged — no registry drift.
- New how-to `docs/how-to/BL-1565-git-handoff-to-coordinator-refused-at-send.md`
  (mirrors `BL-1518-handoff-draft-root-guard.md`'s shape: what it catches,
  how it decides, the exact refusal text, where it lives, verify commands)
  — linked from `docs/index.md` in the same commit, in the send-time-gate
  cluster next to BL-1518.
- `docs/reference/Specification.MD` dated entry added at the top (new
  newest date, prior top entry pushed down as "Prior entry —", per this
  doc's existing changelog convention) summarizing the fix, the two
  retired BL-1536/BL-950 feature slices, the acceptance/how-to pointers,
  and the diagram change — "Last Updated" bumped in the same commit as the
  content change.
- Verified `qa_e2e_procedure` step 4 by hand:
  `grep -n 'coordinator | carries' specs/features/BL-1536-*.feature` is
  empty (exit 1, no match) — the retired example rows are gone.
- No production code, tests, or `.feature` files touched — documentation
  and diagrams only, per role boundary.

By documenter.
