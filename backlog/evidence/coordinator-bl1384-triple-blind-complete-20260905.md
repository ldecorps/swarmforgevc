# BL-1384 blind-completed a third time (2026-09-05)

Coordinator re-routed BL-1384 to coder three times today (03:27Z, 05:16Z,
05:54Z) after each was flagged by the dropped-parcel sweep as "no parcel in
flight - possible drop." Each time, `dispatch_trail_cli.bb` said DISPATCHED
(the recipient copy existed) but no coder implementation commit for BL-1384
exists anywhere (`git log --all --grep=BL-1384` across every worktree shows
only mint/promote/approve/merge-up bookkeeping).

Concrete new evidence for the third occurrence: the completed handoff file
`.worktrees/coder/.swarmforge/handoffs/inbox/completed/10_20260905T055440Z_004395_from_coordinator_to_coder_for_coder.handoff`
shows `dequeued_at: 2026-09-05T06:00:43.705558291Z` and
`completed_at: 2026-09-05T06:00:47.690482819Z` — **4 seconds** between
dequeue and completion for a ticket needing real code (BL-1384's anchor
`readQwenLocalTopicId` is absent today per prior notes). No commit landed
in that window.

Suspected pattern: coder's `type: note` "Work BL-xxx: ..." dispatches
(the message shape `route_backlog_to_coder.sh` sends) seem to get
processed far faster than a `type: git_handoff` — plausibly swept through
in a burst alongside the high-volume `branch behind <sha>: dirty worktree -
merge up` chase notes that pile up every time `main` advances (22 items in
coder's `new/` queue as of this writing, mostly that chase-note shape).
A real ticket dispatch riding in the same note-type queue as a flood of
near-duplicate low-content chase notes may be getting swept past without
being read.

Re-routed a fourth time (only lever available to keep the ticket moving),
but filing this for the specifier's ongoing BL-1415/1416 investigation into
the same failure class — a fifth blind-complete is likely if the
underlying cause (whatever makes a `note`-type Work dispatch processable in
~4 seconds) isn't addressed.
