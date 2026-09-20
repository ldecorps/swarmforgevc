# check_merge_deletion.sh cannot ever be satisfied for an "(unattributed)" deletion

Found merging documenter's second BL-1650 rework (`4d30a08308`) into QA.

## Reproduction

```
$ git merge 4d30a08308 --no-ff -m "... names 0aab479e40, BL-1537, BL-1652 ..."
Error: merge deletes 'swarmforge/scripts/test/test_handoffd_bl1652_chase_respawn_busy_lane_guard.sh'
((unattributed), introduced at 0aab479e40 on the incoming branch), not
named in the commit message.
Commit rejected: name the affected ticket id(s) in the commit message to
confirm a deliberate removal, or re-merge the branch commit(s) that
introduced these paths first.
```

Retried with several different commit messages explicitly naming
`BL-1537`, `BL-1652`, `0aab479e40`, and `(unattributed)` itself — all
refused identically.

## Root cause

`check_merge_deletion.sh`'s `attribution_for_path` reads the ticket id
from the SUBJECT of whichever side's last commit touched the path:

- On HEAD (this branch): my own commit `0aab479e40` ("Restore
  suite-manifest.tsv and remove the stray test to origin/main content"),
  deliberately untagged per the specifier's own ruling
  (`backlog/evidence/BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`,
  condition (f): "ONE commit whose subject names no ticket id").
- On MERGE_HEAD (documenter's incoming side): `c6ecd97d79` ("Merge
  cleaner 0ace704af1 into coder2."), also untagged — an ordinary merge
  subject, not the original `4eacde9068` commit that actually created the
  file (which DOES say "BL-1652:"), because `git log -1 --format=%s
  MERGE_HEAD -- <path>` returns the LAST commit touching the path, and a
  later untagged merge supersedes it as "last".

Both attribution attempts return no ticket id, so `id` is empty. The
violation-check itself is `[[ -n "$id" ]] && grep -qiE "\\b${id}\\b"
<<<"$message"`) — when `id` is empty, this condition is FALSE
unconditionally, so the path is ALWAYS added to `violations`, regardless
of the merge commit's own message content. The guard's own suggested
remedy ("name the affected ticket id(s) in the commit message") is
unsatisfiable by construction whenever `id` resolves empty: there is no
id to name. The second suggested remedy ("re-merge the branch commit(s)
that introduced these paths first") would resurrect the very file the
specifier's ruling told QA to drop — not a real option either.

## Why this is a real gap, not a QA workmanship issue

The specifier's own condition (f) ruling explicitly REQUIRES an untagged
subject for this class of restore commit (to avoid the DIFFERENT
misattribution failure mode this session already hit twice — a
ticket-mentioning subject getting read as that ticket's own work,
BL-1537 conditions covering exactly that). Following that instruction to
the letter produces a commit this OTHER guard can never accept when it
later collides with an equally-untagged commit on the other side of a
merge. The two guards' requirements are mutually exclusive in this
specific shape.

## What I did

Aborted the merge cleanly (`git merge --abort`), working tree clean, no
`--no-verify` used. BL-1650's second rework (documenter commit
`4d30a08308`) is unmerged, held pending resolution.

By QA.

## Instance 2 — BL-1630's forward, same class, no new escalation (2026-09-20)

Identical refusal merging documenter's BL-1630 rework (`4b7615bc14`):
same path, same `(unattributed)` id, same `0aab479e40` on this branch's
side. This is the same structural cause already escalated above (note
`00_20260920T023521Z_003004_from_QA`) — every branch still carrying the
old file (any branch forked before my untagged restore, or that never
independently removed it) will hit this identically on its next forward
to QA. Not re-escalating per Article 4.4 step 4; aborted the merge
cleanly, held BL-1630 pending the same fix.

By QA.

## Instance 3 — BL-1656's re-forward, same class, no new escalation (2026-09-20)

Identical refusal merging documenter's BL-1656 re-forward (`153b16ce09`,
sent after documenter's own BL-490 revert for the earlier bounce). Same
path, same `(unattributed)` id, same `0aab479e40` on this branch's side.
Confirms the class is genuinely swarm-wide: it will refuse every pending
and future forward from any branch that has not itself independently
removed the file until this guard is fixed. Aborted cleanly, held
pending the same fix, no new escalation.

By QA.
