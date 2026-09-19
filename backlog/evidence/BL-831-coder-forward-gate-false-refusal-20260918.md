# BL-831 — done_with_current.sh forward-gate false refusal, 2026-09-18 (coder)

## What happened

Forwarded BL-831's bounce fix (`c6507fe1bd`) to cleaner via
`swarm_handoff.sh` — delivered cleanly:
`HANDOFF DELIVERED:.../outbox/50_20260918T144241Z_000018_from_coder_to_cleaner.handoff`.
Confirmed physically present and already claimed in cleaner's own mailbox:
`/home/carillon/swarmforgevc/.worktrees/cleaner/.swarmforge/handoffs/inbox/in_process/batch_20260918T144253Z_000001/50_20260918T144241Z_000018_from_coder_to_cleaner_for_cleaner.handoff`.

`done_with_current.sh` then refused: `FORWARD_NOT_SENT: BL-831 has no
git_handoff naming it queued since dequeue.`

## Root cause (as far as diagnosable from this seat)

`forward-evidence-lib/sent-handoff-names-ticket-since?` (in
`forward_evidence_lib.bb`) checks only THIS role's own local
`.swarmforge/handoffs/outbox/` and `.swarmforge/handoffs/sent/` for a
`git_handoff` naming the ticket. At the time of the gate check, both
directories were empty of any BL-831 entry — `sent/` empty, `outbox/`
holding only an unrelated 10:10 `.error` file. `tmp/` in this worktree was
also emptied at the same instant (15:42) as the outbox/sent directories'
own mtimes changed, suggesting an external sweep (not this session)
cleared them between delivery and the gate check.

Confirmed NOT stale: re-running `swarm_handoff.sh` with the identical
draft was refused by the tool's own duplicate-parcel check: "Cannot send
git_handoff for BL-831: a live parcel for this ticket already exists at
cleaner ... If that parcel is genuinely stale, clear it first:
redo_from.sh BL-831 <stage>" — i.e. the swarm_handoff tool itself (reading
a different source than the gate) confirms the parcel is live and
undelivered-stale-check-wise fine. `redo_from.sh` was NOT run — the
parcel is genuinely in flight at cleaner (already `in_process`, claimed
by a batch), so clearing it would duplicate/confuse real in-progress
work, not fix anything.

## Why this is surfaced rather than routed around

- `--no-op` would misrepresent a real forward as no functional change —
  false.
- `redo_from.sh BL-831 cleaner` would clear a genuinely live, already-
  claimed parcel — destructive and wrong here.
- Neither escape hatch fits; this is a gate reading stale/missing local
  evidence for work that demonstrably happened.

## Evidence

- Cleaner-side file (present, in_process, claimed):
  `/home/carillon/swarmforgevc/.worktrees/cleaner/.swarmforge/handoffs/inbox/in_process/batch_20260918T144253Z_000001/50_20260918T144241Z_000018_from_coder_to_cleaner_for_cleaner.handoff`
- This worktree's `.swarmforge/handoffs/outbox/` and `sent/`: both empty
  of any BL-831 entry at time of writing.
- `swarm_handoff.sh`'s own duplicate check refusing a resend, naming the
  exact live filename above.

By coder.
