# Landing: did we get the concept wrong? (specifier, 2026-10-01)

The human (via QA, rule_proposal 003669), verbatim:

> Ok with the idea of landing deamon. Let specifier cook up something. Tell it to first assess if we got the while concept wrong? In my mind it should not be much more than a git merge.

Asked first:

> Could we introduce a new role "lander" dedicated to this task? It is takibg far too long and the stops the whole swarm while it runs. Or change the landing logic all together?

## Short answer

Yes, the concept is wrong in one place. The fault is not in the land step
itself but in how a parcel travels before it reaches QA. Fix that, and
landing becomes the git merge the human describes. A daemon can then do
it, so QA's turn is no longer held.

## What happens today

- A role receives a parcel as `merge_and_process <sender> <commit>`
  (handoff-protocol.md). It merges that commit into its own long-lived
  branch (`swarmforge-<role>`), works, and forwards. Every ticket that
  passes through a role stays in that role's branch. QA's merge-up
  broadcast then merges each landed commit into every role branch.
- Measured today: `swarmforge-coder` is 16,462 commits ahead of
  `origin/main`, `swarmforge-cleaner` 16,463 and `swarmforge-QA` 16,590.
- So the commit QA approves carries other tickets' unapproved work as
  ancestors. Pushing it as-is ships work nobody approved: BL-506, and
  BL-1308's reflog shows a land that pushed a ticket held for a human
  ruling. The land step therefore has to work out after the fact which
  changes belong to the ticket. It walks the branch, attributes every path
  to a ticket by commit subject, replays only the ticket's own paths onto
  `origin/main`, decides what to do with strays, records abandoned
  commits, and then re-points QA's branch (land_step_lib.bb's own header:
  "A parcel's cited commit routinely has OTHER tickets' unlanded work as
  an ancestor - ordinary pipelining on a long-lived role branch").

## What it costs

- **Time.** QA holds a ticket for a median of 21 minutes from dequeue to
  land, over the last 20 lands (`qa-last-20-land-times-20260930.png`).
  Outliers run 41, 66 and 82 minutes, and every role downstream waits.
- **Tickets.** About 100 done tickets and 8 open ones exist only to keep
  this machinery right. The count is a title match on land step, replay,
  stray, entangled, re-point, abandoned_commits, merge-up, bounce revert
  and ancestry.
- **Code.** 8,741 lines across the land and gate libs (land_step_lib.bb
  alone is 4,143 lines). 17 scripts reason about entanglement, replay or
  re-point.
- **Hand work.** QA.prompt and the BL-1537 adjudication evidence carry
  hand-build recipes for land conditions (d) through (l). The
  verification-debt ledger has 14 hand checks of land-path ownership in
  six days, the largest category it holds.

The idea was seen before. In BL-1241's evidence (2026-08-29), the coder
wrote: "(c) A per-ticket branch off origin/main - the real fix, but
contradicts Article 1's one-worktree-per-role rule". It does not
contradict that rule. Every role keeps its own worktree; what changes is
which commit that worktree holds.

## What it should be: parcel lines

1. The coder starts each ticket from current `origin/main`, never from
   whatever its branch held before.
2. A role that receives a parcel moves its worktree onto that commit
   (`git switch -C swarmforge-<role> <commit>`) instead of merging it into
   what it held before. It commits on top and forwards. Every commit on
   the line belongs to that one ticket.
3. A bounce sends back the parcel's commit. The earlier role moves onto it
   and fixes forward. There is nothing to revert, because no other branch
   carries it.
4. Landing merges `origin/main` into the approved commit (only when
   `origin/main` has moved) and fast-forward pushes. That is the git merge
   the human describes. A conflict goes back to the coder as an ordinary
   merge conflict.
5. Because landing is now mechanical, a daemon does it: the lander. QA
   approves and moves on. The lander merges, pushes, records the land
   approval and tells the coordinator. No model turn runs and no role
   waits.

Retired once the in-flight parcels drain: the merge-up broadcast, the
post-land re-point, reverse-hop copies, bounce reverts in the bouncing
branch, own-path replay, strays, `abandoned_commits`, entangled-sibling
refusals, the LAND_ESCALATE conditions, and most of land_step_lib.bb.

Unchanged: one worktree per role, the stage order and every gate, the
handoff format (a git_handoff still names one commit), QA's review, and
the depends_on gate. A ticket that needs another ticket's code already
waits for it to land before it can be promoted (BL-957).

## Costs and risks

- **Batch roles.** The cleaner and hardener hold several parcels at once.
  They work them one at a time and switch the worktree between them.
- **Merge skew.** The lander pushes a merge with `origin/main` that no
  role tested. Today's replay has the same exposure, and the standing-red
  register still catches the reds. The lander can run the unit lane on
  the merged tree before it pushes; that is a choice for its slice.
- **Migration.** Parcels already in flight keep the old land step until
  they drain. New tickets start on parcel lines.
- **Constitution.** Article 1.8 (QA lands), Articles 2.4 and 2.5
  (receiving, merge-up) and the workflow rules on lineage, merge-up and
  bounce reverts all change. The specifier writes those changes under
  Article 5 once the human rules.

## The options put to the human (BL-1870)

- **A, recommended.** Parcel lines plus a lander daemon, as above.
- **B.** A lander daemon only: today's land step moves off QA's turn into
  a daemon. QA is freed at once, but each land still takes minutes and
  runs serially, the entanglement machinery stays, and its escalations
  then reach a daemon that cannot judge them.
- **C.** Keep the current landing and measure first. BL-1852 (the
  re-point carries only QA's own commits) and BL-1853 (each commit's diff
  is read once) both landed today, and neither has been measured yet.

If A is chosen, the slices are listed on BL-1870 and are minted after the
ruling, each with only the stages it needs.

By specifier.
