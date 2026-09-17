# BL-1604 — documenter send BLOCKED, 2026-09-17

Sending `git_handoff` for BL-1604 (forwarded `8393648d8b`, received `07d9b3cf20`,
`received_at_head` `50da9272af`) is refused by the merge-drop guard:

```
bb swarmforge/scripts/merge_drop_guard_lib.bb . 07d9b3cf20 8393648d8b 50da9272af
{"merge":"5843bb685c7e6baa700d510d2d8d85b7ea985561","path":"backlog/standing-reds.tsv","side":"sender","lines":2,"excused":false}
```

## This is BL-1610's own predicted recurrence, not a new defect

`5843bb685c` ("Merge commit '0004832c6d' into swarmforge-hardender") is
reachable from the RECEIVED commit's own ancestry (hardener merging the
architect's BL-1604 tip) — not a merge documenter made after receipt. It
predates documenter's dequeue; `received_at_head` (`50da9272af`) cannot
exclude it because the scan (`head..forwarded`) still re-admits everything
inside `received`'s own history whenever `head` lacks it, which is true for
every fresh parcel. `backlog/evidence/BL-1610-bounce-20260917.md` (D1,
hardender's own self-audit finding on BL-1610's send) names this exact
mechanism and the exact fix — invariant 1 amended (`a5e59a0f5b`, on `main`,
merged into this worktree) to bound the scan to
`forwarded ^head ^received`, not yet implemented (BL-1610 still
`assigned_to: coder`, `status: todo`).

Here the finding is **not excused** (unlike BL-1610's own instance) because
this send's own doc pass edits `backlog/standing-reds.tsv` itself (the
ticket's own required doc scope — the "and no other land removes it"
sentence), so `blob(forwarded) != blob(received)` at that path and BL-1610's
already-shipped blob-identity excuse (invariant 2, `bad08ffacb`) cannot
apply.

## Verified harmless: nothing the merge is accused of dropping is actually missing

```
git merge-base 539f500112 0004832c6d   # a5e59a0f5b (the amendment's own base)
git show 539f500112:backlog/standing-reds.tsv  # == a5e59a0f5b's own copy, byte-identical
git show 8393648d8b:backlog/standing-reds.tsv | grep -c 'BL-1608\|BL-1607'   # 2
```

`539f500112` (hardener's own branch, the merge's "sender" side) already
carried both rows the merge is accused of dropping (BL-1608's and BL-1607's
standing-red rows) byte-identical to the merge base; the merge kept them
correctly. `0004832c6d` (architect's side) simply had not yet synced the
main commit that added those two rows — an ordinary fast-moving-`main`
gap, not a one-sided drop of contested content. Both rows are present,
byte-identical, in this send's own forwarded tree (`8393648d8b`). No content
this ticket or any other open ticket owns is at risk.

## Not blocked (content), blocked (gate)

`--blocked 0` for content purposes: nothing is actually lost. The gate
itself has no mechanism to excuse this shape today (BL-1610's amendment is
the only fix, not yet coded) — recorded here rather than worked around, per
"Never Blind-Forward A Bounce You Cannot Fix": this is BL-1610's own gate
defect, not documenter's or hardener's to redesign.

## Retry after merge-up (coordinator notes 009021/009024, 2026-09-17)

Merged `main` `6c95a92517` into this worktree (`b23a1e5a58`, clean, no
conflicts) per the coordinator's "branch behind — merge up" notes, then
retried the real `swarm_handoff.sh` send with `commit: b23a1e5a58`. Same
guard, same refusal, same merge (`5843bb685c`) named. The merge-up did not
and could not change this outcome — the blocking commit is inside
`received`'s own ancestry, upstream of anything this worktree's merges
touch. Still waiting on BL-1610 (`assigned_to: coder`) before this send can
queue.
