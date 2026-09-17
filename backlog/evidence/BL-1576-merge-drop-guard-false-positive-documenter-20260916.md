# BL-1576 merge-drop guard — false-positive finding blocking BL-1599 and BL-1607, 2026-09-16

## The finding

`swarm_handoff.sh` refuses to send BOTH BL-1599 and BL-1607 with:

```
Cannot send git_handoff for <ticket>: merge c96761faa105bdf14b9eb68577dafc6a1e02c526
dropped 3 lines of the received side's uncontested hunks in
backlog/standing-reds.tsv - a one-sided merge resolution discarded
uncontested work (BL-1576).
```

## Diagnosis (full trace, `merge_drop_guard_lib.bb` read live, not guessed)

`c96761faa1` ("Merge QA 6607854833 into documenter.") has parents
`d10849128c` (my own prior tip) and `6607854833` (QA's BL-1602-landed
note). Neither parent is an ancestor of BL-1599's own received commit
(`46c409305c`, on a separate hardender branch not yet merged at the time
`c96761faa1` was made), so `side-label`'s own documented ancestor-fallback
mislabels `d10849128c` as "received" — this merge sits entirely OUTSIDE
the single-sender/single-receiver shape the gate's own docstring says it
answers, purely because of how many concurrent role branches get merged
sequentially into one documenter worktree in a single session.

Traced the actual content, `git diff -U0 <merge-base> <side> -- backlog/standing-reds.tsv`
for both parents against their true merge-base (`1fce68ec4a`):

- `d10849128c` ("received") removed 6 rows relative to base: 3
  (BL-1001/1004/1167, discharged elsewhere) plus 3 (BL-1607's own row and
  BL-1606's two rows) — the BL-1606/1607 removal came from `e102e1a5a7`
  ("BL-1607: shipped-step scan budget grows with the unit lane's own
  forks"), a coder commit that removed BL-1607's register row believing
  the fix was complete. It was NOT complete — I bounced that same commit
  the same day for missing the `required_wiring` literal
  (`backlog/evidence/BL-1607-documenter-bounce-20260916.md`).
- `6607854833` ("sender"/QA) removed a different, non-overlapping set (9
  rows, the real BL-1602 discharge) and ADDED the BL-1606/1607 rows fresh
  (QA's own tree still had them, from before `e102e1a5a7` landed on any
  branch QA saw).
- My merge took QA's content for this path — content-wise CORRECT, since
  `e102e1a5a7`'s row removal was itself premature (the underlying defect
  wasn't fixed yet), so resurrecting the row was the right call, not a
  loss. Verified directly against the CURRENT tree: BL-1602's rows are
  correctly absent (really landed), BL-1606's rows are correctly absent
  (really landed, later, via a separate QA note), BL-1607's row is
  correctly present (that ticket's fix only landed today after two
  bounces, `ab511c4947`).

The guard has no way to know `e102e1a5a7`'s removal was itself premature
— it only sees "one side's uncontested hunk didn't survive the merge" and
refuses, correctly by its own narrow rule, on content that was already
independently verified correct.

## Why I am not forcing this through

`revert-excuses?` only accepts a `This reverts commit <full-sha>` trailer
in a later commit's message — checked by grep, not by content. Fabricating
that trailer without actually running `git revert e102e1a5a7` (which would
also revert its now-superseded-but-still-needed code changes, since later
commits built on top of it) would be a false claim in a commit message,
not a genuine fix. `abandoned_commits:` (the PRE_QA_GATE ancestry gate's
own escape hatch) is NOT consulted by `merge_drop_guard_lib.bb` at all —
I tried it on both tickets' YAML and the refusal is unchanged.

This is a gate/tooling gap: the guard's single-sender/single-receiver
shape does not hold for a documenter worktree that sequentially merges
many concurrent role branches (main syncs, multiple tickets' QA-approval
notes, multiple bounce/resubmit cycles for the same ticket) in one
session — exactly the swarm's actual, routine operating shape. Per the
constitution, a defect in the swarm's own delivery machinery is expeditor
territory, not mine to route around from inside the pipeline it blocks.

## What is blocked

- BL-1599 (documenter tip `2be80a55f8`/`650cf6ecf7`): fully documented,
  ready, blocked only by this finding.
- BL-1607 (documenter tip `598af6a4c7`): fully documented, coder's fix
  (`ab511c4947`) verified to satisfy the required_wiring literal, ready,
  blocked only by this finding.

Both tickets' own `abandoned_commits:` fields already carry a full
verification note for the record; this file is the shared root-cause
evidence for both.

By documenter.
