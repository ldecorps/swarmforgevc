# Evidence — QA's `main` rematch-reset silently dropped two coordinator commits (BL-1198 live occurrence)

**Found by:** coordinator, 2026-08-27 ~19:37 BST, while bookkeeping QA's BL-1184 approval.

## What happened

Earlier the same shift, the coordinator (following the expeditor's own
`run.json` "outstanding" instructions for BL-1200) committed two commits to
`main`:

    4b3bfa5f2  Expedite BL-1200: park 7 active tickets to hold, adopt BL-1200 into active
    e6f4e8a80  BL-1200: assign to cleaner, record expedite coder-stage handoff

Both landed cleanly at the time (`main` was a clean fast-forward off a
detached HEAD; no divergence).

QA's own BL-1184 land sequence then ran:

    20eac7683  merge: rematch tip onto origin/main before BL-1184 land. By QA.
    d523266823 evidence(BL-1184): record QA pass...

After that rematch, `4b3bfa5f2` and `e6f4e8a80` are **not** ancestors of
`main` (`git merge-base --is-ancestor 4b3bfa5f2 main` → false), even though
both objects are still present (`git cat-file -t` → `commit` for both — not
lost, just unreachable from any ref). Consequently:

- `backlog/active/` reverted to its pre-park state: all 7 tickets the
  expeditor had parked (BL-1184, BL-644, BL-751, BL-1188, BL-592, BL-428,
  BL-1189) are back in `backlog/active/`.
- `backlog/hold/` reverted to only its pre-existing entry (BL-472).
- `BL-1200` reverted from `backlog/active/` (assigned_to: cleaner) back to
  `backlog/paused/`, unassigned — even though a `git_handoff` referencing
  its coder-stage commit (`f31114adfc`) had already been sent to cleaner.

## Disposition

- This is a live occurrence of the exact class **BL-1198** (paused,
  `backlog/paused/BL-1198-main-rematch-reset-must-attempt-push-before-discarding-local-ahead-commits.yaml`)
  already exists for: a "rematch onto origin/main" reset discarding local
  commits ahead of origin without pushing them first.
- No content is unrecoverable — both dropped commits are intact loose
  objects, `4b3bfa5f2` and `e6f4e8a80`, recoverable by cherry-pick/rebase.
- The coordinator is **not** replaying those commits: BL-1200's expedite run
  had already finished `failed` (see `.swarmforge/expedite/BL-1200/run.json`)
  and the reverted state (7 tickets active, BL-1200 back in ordinary
  paused/unassigned) is itself coherent — re-imposing the park now would just
  be churn against a run that did not succeed anyway.
- BL-1184 itself is unaffected: QA's own worktree carried it through the
  pipeline independently of the master-checkout park, and it has been
  bookkept to `backlog/done/` normally.
