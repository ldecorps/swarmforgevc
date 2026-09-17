# coder@2 seat mailbox is undrainable by its own dispatcher — 2026-09-17

Reported by coder@2 (this worktree, `.worktrees/coder2`), discovered while
idling after completing BL-1604 and a BL-1610 bounce rework, both of which
turned out to duplicate the primary `coder` seat's own independent work
(separate notes already sent to the coordinator this session).

## The mismatch

`swarmforge/scripts/handoff_lib.bb`'s `stage-queue-dir` (BL-983) resolves
a SEAT's new-mail queue to its STAGE's shared mailbox whenever a distinct
stage row exists in `roles.tsv`:

```
(seat-stage "coder@2") => "coder"
(stage-queue-dir :new) for coder@2 => /home/carillon/swarmforgevc/.worktrees/coder/.swarmforge/handoffs/inbox/new
```

`ready_for_next_task.bb` reads candidates ONLY from `stage-queue-dir` -
never from the seat's own `my-mailbox-dir`. Verified directly:

```
bb -e '(load-file "handoff_lib.bb")
       (println (handoff-lib/current-role))
       (println (str (handoff-lib/my-mailbox-dir :new)))
       (println (str (handoff-lib/stage-queue-dir :new)))'
=> coder@2
=> /home/carillon/swarmforgevc/.worktrees/coder2/.swarmforge/handoffs/inbox/new
=> /home/carillon/swarmforgevc/.worktrees/coder/.swarmforge/handoffs/inbox/new
```

Meanwhile, at least the following senders addressed parcels directly `to:
coder@2` / `recipient: coder@2` this session, and those were delivered
into THIS worktree's own `inbox/new/` (`.worktrees/coder2/...`), never
into the shared `coder` stage mailbox `ready_for_next.sh` actually reads:

- `00_20260917T061947Z_000783_from_cleaner_to_coder@2_for_coder@2.handoff`
  (reverse-hop, has a `.chase.json` sidecar — the daemon's own chase sweep
  already flagged it stale)
- `00_20260917T062328Z_002144_from_architect_to_coder@2_for_coder@2.handoff`
  (same, also chased)
- `00_20260917T065549Z_000786_from_cleaner_to_coder@2_for_coder@2.handoff`
- `10_20260917T061544Z_009012_from_coordinator_to_coder@2_for_coder@2.handoff`
- `10_20260917T064325Z_009025_from_coordinator_to_coder@2_for_coder@2.handoff`
- `10_20260917T065415Z_009026_from_coordinator_to_coder@2_for_coder@2.handoff`

Three consecutive `ready_for_next.sh` calls (each following a "you have
new handoff mail" wake) all printed `NO_TASK` while these six sat
untouched. None of them will EVER be claimed by this seat's own dispatcher
as the code stands today - not a timing issue, a structural one.

## Likely connection to the duplicate-work incidents already reported

Two notes already sent to the coordinator this session (BL-1604 and a
BL-1610 bounce rework both independently duplicated by the primary
`coder` seat) are plausibly explained by the OTHER half of this same
mechanism: a parcel addressed generically `to: coder` lands in the ONE
shared stage mailbox (`.worktrees/coder`), and BOTH seats' dispatchers can
see it there (my own `stage-queue-dir` resolves to that same shared
directory) - if nothing serializes the claim between two seats reading the
same directory at close to the same time, both can dequeue-and-work the
SAME file before either one's move-to-in_process is visible to the other.
Whether that race is real (vs. some other duplicate-cause) is worth the
daemon owner's own look; this report only establishes the mailbox-address
mismatch with certainty.

## What this seat did NOT do

Did not hand-move, hand-claim, or delete any of the six stuck files - the
daemon's own chase/nudge and eventual endless-loop circuit breaker are the
mechanisms meant to handle this, and hand-editing a live mailbox from
inside a role turn risks exactly the corruption those mechanisms exist to
avoid. Reporting only.

By coder@2.
