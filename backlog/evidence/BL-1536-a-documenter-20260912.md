# BL-1536-a — documenter review pass, 2026-09-12

NONE. The full checklist was run and found no defect.

Recorded as an explicit NONE rather than skipped: an inventory is a pass
artifact, not only a bounce artifact (Article 4.4), and the forward names
THIS commit rather than the received hash (BL-536).

By documenter.

## Detail

Checked against the ticket's own "Docs" guidance:

- `swarmforge/constitution/articles/02_handoffs.md` "Reverse hops" — the
  terminal-stamp sentence ("The last non-coordinator pack role's forward
  `git_handoff` is also stamped `non-forwarding: true` (terminal)") already
  reads as "forward", matching the fixed direction-based behavior; the
  ticket's own approval_context calls this wording "already right" and it
  stays.
- `swarmforge/handoff-protocol.md` — grepped for `stamp`, `terminal`,
  `last-pack-role`, `last pipeline role`: no section describes the old
  sender-only stamping rule that BL-1536 replaced, so nothing there went
  stale. The two live mentions of `non-forwarding` (Duplicate-Chain Guard
  section and the QA approval/merge-up section) describe the marker's
  effect on the receiving/guard side, unaffected by this fix.
- `docs/diagrams/handoff-flow.mmd` — grepped for `non-forwarding`: no match
  (the one `stamp` hit is unrelated, `dequeued_at`). Confirmed rather than
  assumed, per the ticket note: no diagram-currency trigger fires.
- `docs/reference/Specification.MD` and
  `docs/how-to/BL-1317-adapt-tier-effort-from-outcome-signals.md` mention
  `non-forwarding` but describe unrelated fixes (BL-1313 batch-mailbox
  visibility; the bounce/clean outcome classifier) that read the marker's
  presence, not who gets stamped — both stay accurate.

Gates run: none applicable (no doc content changed; this is a
docs-confirmed-clean pass). Production/test changes (reverse_hop_lib.bb,
swarm_handoff.bb, bb runner, shell test, acceptance handler, property test)
were already hardener-reviewed (BL-1536-a-hardender-20260912.md, NONE) and
architect-reviewed (BL-1536-a-architect-20260912.md, NONE) ahead of this
stage; nothing in that diff touches a documenter-owned artifact.

By documenter.
