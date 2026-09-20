# BL-1652: PRE_QA_GATE_FAIL ancestry — duplicate seat rework stranded on swarmforge-coder@2

Recorded by: documenter, 2026-09-20, while forwarding BL-1652's completed
documentation pass to QA.

## What the gate said

```
PRE_QA_GATE_FAIL ancestry BL-1652 4eacde9068 stranded on swarmforge-coder@2
```

`swarm_handoff.sh` refused the `git_handoff` to QA (commit `ba49c91ed6` on
`swarmforge-documenter`) because a second commit tagged `BL-1652` exists on
branch `swarmforge-coder@2` and is neither merged into the pipeline lineage
nor recorded under the ticket's `abandoned_commits:`.

## What the two commits are

- `43213a6bc2` (2026-09-20 01:08:58+01:00, on `swarmforge-coder`) — the
  commit that actually rode the pipeline: cleaner (`0ace704af1`), architect
  (`1c9677b6b2`), hardener (`5bee934afc`, `5f30ea5596`), and now documenter
  (`e67b7f6b9b`) all reviewed and built on this lineage.
- `4eacde9068` (2026-09-20 01:41:01+01:00, on `swarmforge-coder@2`) — a
  SECOND, independent implementation of the same ticket, committed 32
  minutes after the first, on the `coder@2` branch. Its own commit body
  describes the same two invariants (busy/lane guard folded into
  `has-recent-activity?`; one-respawn-per-role-per-sweep cap) with a
  different implementation shape (folds the readings into the existing
  activity check rather than gating the "respawned" branch directly). It
  was never reviewed, never merged, and does not appear anywhere in the
  `swarmforge-documenter` lineage.

`swarmforge-coder@2`'s tip is `cd3568b787` ("Merge main da60541983 into
coder2.") with `4eacde9068` one commit before that — i.e. this was the
LAST thing done on that branch; nothing since retracted or superseded it
there.

## Likely cause

Matches the standing `coder2-stage-queue-dir-mismatch-root-cause-0917`
watch entry: a second live coder seat (coder@2) independently picked up
and implemented BL-1652 in parallel with the real coder seat, because
coder@2's stage-queue-dir reads the shared coder mailbox rather than its
own. Same shape as the BL-1616/BL-1636 duplicate-seat-rework incidents.

## What this parcel needs from the specifier

This is a ticket-content judgment call (abandon vs. reconcile), which is
the specifier's domain (Article 1.2), not documenter's. The documentation
pass on the REAL lineage (`43213a6bc2` → ... → `e67b7f6b9b`) is complete
and already reviewed; only the gate's ancestry check is blocking the
forward to QA.

Suggested resolution (for the specifier to confirm/adjudicate): record
`4eacde9068` under BL-1652's `abandoned_commits:` in
`backlog/active/BL-1652-the-chase-sweep-never-respawns-a-busy-role-and-respawns-at-most-once-per-sweep.yaml`,
since the real implementation already landed on the reviewed lineage and
diverges in approach from the abandoned one (no content to reconcile).

## Documenter's own state

`swarmforge-documenter` HEAD is `e67b7f6b9b` (doc commit) — untouched by
this stray; nothing to revert. Parcel held in `in_process`, not forwarded,
pending the specifier's ruling.
