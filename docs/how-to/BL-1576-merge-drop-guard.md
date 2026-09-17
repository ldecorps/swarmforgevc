# Merge-drop guard on `git_handoff` sends (BL-1576)

*How-to. Task-oriented: understand why a `git_handoff` send was refused
for a one-sided merge resolution that discarded uncontested work, and how
to clear it.*

Send-time gate in `swarm_handoff.sh`, alongside the other send-time gates
including [BL-1213's parcel-rollback guard](BL-1213-parcel-rollback-guard.md)
(same file, same fail-open posture). Full mechanics:
[`swarmforge/handoff-protocol.md`](../../swarmforge/handoff-protocol.md#merge-drop-guard-bl-1576).

## What it catches

A merge commit the sender made on its own branch, between the parcel's
received commit and the commit it is about to forward, that resolved a
conflicted path by keeping one side verbatim and silently dropping hunks
the OTHER side had the only claim to. This happens when git raises a
conflict on ADJACENT edits — two sides changing nearby but non-overlapping
line ranges of the same path — and the resolver picks one side wholesale
instead of keeping both. The live incident (2026-09-15, BL-1486): a
documenter merge resolved a conflict on `backlog/standing-reds.tsv` by
keeping its own side, silently re-adding six rows the hardener had removed
in an uncontested hunk. Every existing guard read clean — BL-1213 is
bounded to paths the *received* commit itself touched; BL-1242 fires only
on path deletions; BL-1098 excuses content that a merge commit itself
authored. Only QA's hand diff against both parents caught it.

## What it does NOT catch, on purpose

- A genuine same-line conflict: when both sides touch the *same* base line
  range, or insert at the same base position, the hunks are CONTESTED and
  the pick is always the resolver's — never a finding (invariant 2).
- A deliberate `git revert` of the commit that authored the dropped hunk,
  reachable from the forwarded commit (`This reverts commit <sha>` in the
  body) — the BL-490/BL-495 bounce-revert convention, same as BL-1213.
- A merge the sender did not make since it received the parcel: the scan
  is bounded to merges reachable from the forwarded commit and not from
  the sender's `received_at_head` dequeue stamp (BL-1610), falling back to
  the full received..forwarded range only for an older parcel with no
  stamp.
- A finding whose path the forward carries unchanged from what was
  received — the forward's blob at that path equals the received commit's
  blob there, so nothing dropped can ride it (BL-1610 invariant 2; still
  blocks when the offending merge itself is the commit being forwarded).
- A `note` handoff — only `git_handoff` sends are checked.

## If you hit this refusal

```text
Cannot send git_handoff for BL-901: merge 4566a68955 dropped 6 lines of
the received side's uncontested hunks in backlog/standing-reds.tsv - a
one-sided merge resolution discarded uncontested work (BL-1576). If this
is a deliberate BL-490/BL-495 bounce revert, carry a proper revert of the
commit that authored the dropped hunk; otherwise redo the merge resolution
to keep both sides before sending.
```

1. If you genuinely meant to revert the commit that authored the dropped
   hunk, do it properly (`git revert`) rather than resolving a merge by
   discarding its content — the guard reads revert history, not just
   current content.
2. Otherwise, redo the merge resolution so both sides' uncontested hunks
   survive (for an adjacent-edit conflict, that almost always means
   keeping both, not choosing one side), then re-send.

## Where it lives

| Piece | Location |
| --- | --- |
| Guard library | `swarmforge/scripts/merge_drop_guard_lib.bb` |
| Wired into | `swarmforge/scripts/swarm_handoff.bb` (send-time `validate`) |
| Acceptance steps | `specs/pipeline/steps/bl1576MergeDropGuardSteps.js` |
| Read-only CLI (no fixture) | `bb swarmforge/scripts/merge_drop_guard_lib.bb <project-root> <received-commit> <forwarded-commit> [head-commit]` — prints one JSON finding per line, each carrying `:excused` (BL-1610); the optional 4th arg reproduces the send-time `received_at_head`-bounded scan |

## Related

- [BL-1213](BL-1213-parcel-rollback-guard.md) (parcel-rollback guard) — bounded to the paths the *received* commit itself touched and fires on a byte-identical tip; this gate is a distinct, sixth question in the same incident thread and does not re-tune BL-1213.
- BL-1242 (merge-deletion commit-msg hook), BL-1098 (push-sweep silent-revert predicate), BL-1205 (tree-collapse guard) — sibling guards read and positioned during BL-1576's design; none of them is edited by this ticket.
- BL-1610 bounds this guard's scan to `received_at_head..forwarded` and excuses a finding whose path the forward carries unchanged from what was received, fixing a false refusal when the received commit is the coordinator's route `git_handoff` (main's own tip).

## Verify

```bash
bash swarmforge/scripts/test/merge_drop_guard_lib_test_runner.bb
bb swarmforge/scripts/test/bl1576_merge_drop_guard_property_runner.bb
node specs/pipeline/cli.js specs/features/BL-1576-a-forward-is-refused-when-a-merge-dropped-one-sides-uncontested-hunks.feature
```

Acceptance: `specs/features/BL-1576-a-forward-is-refused-when-a-merge-dropped-one-sides-uncontested-hunks.feature`
