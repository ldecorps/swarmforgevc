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

## Update — 2nd occurrence, ~19:42 BST: the close itself got wiped

The coordinator's own `git mv active/ -> done/` + commit for BL-1184 (sha
`de9f94966`, done right after the update above) was **itself** dropped by a
second QA rematch-reset shortly after (during BL-428's land sequence).
`backlog/active/BL-1184-briefing-shift-velocity.yaml` reappeared with the
same pre-close content (`git log` on that path shows only `173d224a6` /
`21d595626`, `de9f94966` is not in its history), while
`backlog/done/BL-1184-briefing-shift-velocity.yaml` does not exist.

Worse: re-running `commit_integrity_cli.bb`'s close now **fails its own
authorization gate** — `CLOSE BLOCKED for BL-1184 — no QA git_handoff or
note to coordinator referencing this ticket` — because the rematch didn't
just drop the close commit, it also left the coordinator's copy of QA's
original approval handoff sitting in
`.swarmforge/handoffs/coordinator/inbox/abandoned/` (consumed by the first,
now-erased close) rather than somewhere the gate re-reads. The QA-authored
evidence commit itself (`d523266823`) is still intact and still an ancestor
of `main` — the approval is real and undisputed, only the live-mailbox
record of it is gone.

Coordinator did NOT re-close by hand (would require bypassing the gate) and
did NOT re-park anything. Sent `note` (priority `00`) to QA asking it to
resend approval for BL-1184 so the gate has something to authorize against.
Two occurrences of the same class in under 10 minutes on this checkout is
worth the human's attention beyond BL-1198's existing paused priority —
flagging severity here rather than reassigning it unilaterally.
