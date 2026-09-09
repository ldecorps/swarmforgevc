# Article 4.2 / BL-247 escalation on 6246c02ff3 — FALSE POSITIVE (operator, 2026-09-04T21:52Z)

Two `BABYSITTER_ESCALATION` events in this batch:

1. `pipeline-code-on-main-6246c02ff3...` — `BL-1395: tip-pure land -- own paths
   only, replayed onto origin/main` (author `t <t@t>`, 2026-09-04T21:35:34Z
   authored / 21:45:35Z committed — `+01:00` git dates CONVERTED to UTC, not
   relabelled), for:
   - extension/test/bl1252CommitGuardAggregationInvariants.property.test.js
   - extension/test/bl1395BbScriptsLoadGuard.property.test.js
   - extension/test/bl632CommitTimeGuardInvariants.property.test.js
   - specs/pipeline/steps/bl1395DaemonBootedBeforePublishSteps.js
2. `pipeline-code-on-main-7b3d2108fc...` (BL-1399) — a **re-delivery** of the
   escalation already dismissed at 21:21Z in
   `babysitter-article42-bl1399-tip-pure-land-false-positive-20260904.md`.
   Disposition unchanged; nothing re-verified beyond the ancestry point below.

## Why event 1 is a false positive

Tenth instance in two days of the standing ancestry-only class (memory
`article42-predicate-is-ancestry-only-qa-handland-always-flags`; siblings:
`...-bl1399-...`, `...-qa-handland-on-main-...`, `...-bl1390-...`,
`...-bl1386-bl1387-...`, `...-bl1362-...`, `...-bl1358-...`,
`...-expedite-lane-land-...`, `...-union-merge-...`, `...-expedite-rematch-...`).

VERIFIED, not assumed:

- `is_qa_ancestor.sh 6246c02ff3` → exit 1.
- The **bounce arm of that exit is ruled out**: no `6246c02ff3` in
  `.swarmforge/bounces/`, and no `commit: 6246c02ff3` in any tracked
  `bounce_history`. So the "no" is purely ancestry.
- The commit body carries the QA attribution (`By QA.`), the evidence
  citations, `abandoned_commits: [744a35ca13]`, and the BL-1386 route-1
  hand-build rationale. QA authored the land.
- Single parent (`4239b65b55`); `origin/main...main` = 0/0; no `MERGE_HEAD`
  (checked via `git rev-parse --git-dir`, per the linked-worktree
  `.git`-is-a-file trap).
- Content vs the QA tip `a329461e11`, blob SHAs per path: three of four are
  **byte-identical** (`e418b07f42`, `6eb0e16d75`, `68d197e879`).

### The one non-identical path — checked, and correct

`extension/test/bl632CommitTimeGuardInvariants.property.test.js` is
`590143de6a` on main vs `9b8dbde23f` on the QA tip. The delta is **sibling
BL-1398 content correctly excluded**, not a drop of BL-1395's own work: the QA
ref already carries BL-1398's `deriveCommitGuardFixtureSet` refactor (BL-1398 is
still active, `bl1398-tip-pure` unlanded), while main got the pre-BL-1398
hand-written guard list **with BL-1395's own `BB_LOAD_GUARD` addition present**.
That is exactly what a tip-pure "own attributed paths, replayed onto
origin/main" build is supposed to produce. BL-1398's land derives the list, so
it supersedes this hunk rather than colliding with it.

## Refinement of the 21:21Z framing — the window is real but UNBOUNDED

That run called the exit-1 on a tip-pure hand-land a **race window** (main push
preceding the `swarmforge-QA` merge-back) expected to self-clear. The mechanism
is right — merging main up into `swarmforge-QA` does make these shas ancestors,
and both earlier instances confirm it (`485fd43bce` BL-1358 and `0dab987fac`
BL-1362 are ancestors of `swarmforge-QA` today). What is wrong is the **~6-10
minute** duration on file. Re-checked at 21:52Z, 38 minutes after the BL-1399
land: `7b3d2108fc` is **still not** an ancestor, and `6246c02ff3` is not either.

Measured now: `swarmforge-QA` is **14 commits behind main** and 1049 ahead;
its last merge was `a329461e11` at 21:47:02Z, which did not pick up either
flagged sha. QA merges specific parcels up, not main wholesale, so the gap
closes only when QA next merges main — and QA is 45 minutes into a single turn.

**How to apply:** do not wait out, and do not date, the window. The timing-free
dismissal already on file — comparing blob SHAs of the flagged paths on both
sides — is the check that answers correctly at any age, and it is what settled
this one. An Art 4.2 CRIT on a `tip-pure land` subject is expected noise
whether it is 5 minutes or 5 hours old.

## Action taken

None. No nudge, no respawn, no commit, no code edited, no backlog-state change.
This file is untracked and NOT committed (main is the coordinator's live
worktree). The predicate fix is the swarm's to make, not the operator's.

## Re-delivery, 2026-09-04T22:50Z (operator, 2nd delivery of this exact sha)

The babysitter re-emitted `pipeline-code-on-main-6246c02ff3...` with the same
four paths. Disposition UNCHANGED — false positive, no action. Re-confirmed the
cheap immutable arms only (a commit object cannot go stale):

- `is_qa_ancestor.sh 6246c02ff3` → rc=1, read directly from `$?` (not piped —
  the tail-masks-rc trap).
- Bounce arm still ruled out: the only `6246c02ff3` hit anywhere under
  `.swarmforge/bounces/` or `backlog/` is THIS evidence file. So the "no" is
  purely the ancestry arm the BL-1376 tip-pure route guarantees.
- Blob-SHA compare `main:<path>` vs `swarmforge-QA:<path>` — 4/4 IDENTICAL
  (`e418b07f42`, `6eb0e16d75`, `9b8dbde23f`, `68d197e879`). The code on main IS
  what QA holds; only ancestry differs.

Independent corroboration: the COORDINATOR pane reached the same verdict on its
own at 22:49Z ("Duplicate of an already-confirmed finding … No new action
needed.").

19th instance of the documented ancestry-only class
(`article42-predicate-is-ancestry-only-qa-handland-always-flags`). No duplicate
evidence file written — a second file would inflate the class count.

## Re-delivery, 2026-09-04T23:20Z (operator, 3rd delivery of this exact sha)

The babysitter emitted `pipeline-code-on-main-6246c02ff3...` a THIRD time with
the same four paths. Disposition UNCHANGED — false positive, no action. Per the
standing rule for this class, no duplicate evidence file was written and the
already-verified arms were not re-derived; only the two cheap immutable arms
were re-confirmed:

- `is_qa_ancestor.sh 6246c02ff3ca...` → rc=1, read directly from `$?` with
  output redirected to a file (not piped — the tail-masks-rc trap).
- Bounce arm STILL EMPTY: 0 hits for `6246c02ff3` under `.swarmforge/bounces/`.
  So the "no" is PURELY the ancestry arm, which the BL-1376 tip-pure hand-land
  route guarantees by construction.

The blob-identity compare (4/4 paths byte-identical main = swarmforge-QA =
origin/main: `e418b07f42`, `6eb0e16d75`, `9b8dbde23f`, `68d197e879`) was done at
the 22:50Z delivery and a commit object is immutable, so it was not repeated.

Independent corroboration, again: the COORDINATOR received the identical
escalation and ruled in-pane at 23:20Z — "Duplicate of an already-confirmed
finding … No new action needed." It ALSO added, on its own initiative, the
observation that this same batch of subjects (BL-1382/1398/1388/1399/1393/1395)
"has now recurred multiple times unchanged — worth checking whether the
babysitter sweep has a dedup gap rather than continuing to re-verify each
cycle." That is the coordinator's call to mint or not; the operator did not
mint, route, or nudge on it.

25th instance of the documented ancestry-only class
(`article42-predicate-is-ancestry-only-qa-handland-always-flags`), and the 5th
escalation wake of this class tonight.

## FIFTH delivery — 2026-09-04T23:51Z (operator)

Same `pipeline-code-on-main-6246c02ff3...` event, same four paths, same
disposition: **FALSE POSITIVE, no action.** This sha has now been delivered 5
times (4 prior batches under `.swarmforge/operator/events-done/`, plus this
one) and dismissed every time since the original 21:52Z verification above.

Commit objects are immutable, so nothing above was re-derived. Re-confirmed
only the two cheap arms:

- `is_qa_ancestor.sh 6246c02ff3...` → **rc=1**, read directly from `$?` with
  output redirected to a file (not piped — the tail-masks-rc trap).
- **Bounce arm empty**: 0 hits for `6246c02ff3` under `.swarmforge/bounces/`.

So the "no" is purely the ancestry arm that the BL-1376 tip-pure hand-land
route guarantees — the standing ancestry-only class
(`article42-predicate-is-ancestry-only-qa-handland-always-flags`), ~31st
instance in two days.

Appended here rather than written as a new file: a new file would inflate the
class count. The recurrence itself is the coordinator's open babysitter-sweep
dedup-gap observation (flagged in its pane at 23:20Z); minting/routing that is
its call, not the operator's.
