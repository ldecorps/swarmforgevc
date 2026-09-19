# BL-1609 forward-gate gap — QA note-based completion, 2026-09-19

`forward-gate!` (`swarmforge/scripts/forward_evidence_lib.bb`,
`forwarding-inbound?`) decides purely from the INBOUND's header: type
`git_handoff` and no `non-forwarding: true`. It treats every non-
master-resident role the same, requiring a sent `git_handoff` naming the
ticket since dequeue, or a `--no-op` reason.

QA is not master-resident (worktree `QA`), but per Article 1.8/2.5, QA's
approval path never sends a `git_handoff` forward — it sends a `note`
broadcast to the pipeline roles plus a `note` to the coordinator, and
lands the commit itself. QA is a legitimate second exception to
`forwarding-inbound?`'s "master-resident or refuse" split, alongside
the already-modeled one.

Observed on BL-831 (parcel 00_20260918T154615Z_001373): a received
`git_handoff` from documenter, approved (NONE), landed at `cdeb8bdfdb`,
merge-up note broadcast to coder/cleaner/architect/hardender/documenter
and a bookkeeping note to coordinator both sent — then
`done_with_current.sh` refused plainly with `FORWARD_NOT_SENT`. Worked
around with `--no-op "<reason>"` per the tool's own suggested escape
hatch; the approval, land, and notifications are unaffected. Every QA
approval will hit this same refusal until the gate accounts for QA's
note-only forward.

Suggested remedy shape (specifier's to decide): extend
`forward-completion-decision`'s inputs with a `qa-approval-note-sent?`
signal (a `note` to `coordinator` naming the same ticket since dequeue),
so QA completes plainly on note evidence instead of requiring a
`--no-op` reason on every pass.

By QA.
