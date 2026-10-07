# Article 4.2 (007d54a2c4, 73493e93c1) — coordinator close-out, 2026-10-07T22:43Z

Answers the open question in `art42-origin-main-1007.md`: why the push
carried `swarmforge-QA` onto `origin/main`.

## Root cause found and fixed

`.worktrees/QA`'s local branch `swarmforge-QA` had its upstream
misconfigured:

```
branch.swarmforge-QA.remote = origin
branch.swarmforge-QA.merge  = refs/heads/main
```

A plain `git push` from that worktree therefore pushed QA's own
in-review commits straight onto `origin/main`, bypassing the land gate.
Fixed (config-only, no working-tree/HEAD change, safe beside the live
round-5 `qa-gather` in that same worktree):

```
git -C .worktrees/QA branch --set-upstream-to=origin/swarmforge-QA swarmforge-QA
```

Verified: `branch.swarmforge-QA.merge` now reads `refs/heads/swarmforge-QA`.
This prevents recurrence on QA's next push; it does not touch what is
already on `origin/main`.

## Why no waive, no revert, no merge

- Not a false positive: the evidence file is right that unapproved,
  still-active-ticket content is genuinely on `origin/main`. A waive would
  misrepresent that as adjudicated-and-accepted.
- Not a land either: BL-1880 is still `backlog/active/`, no land-approval
  record exists. Close-out option 1 (QA's land-approval record) doesn't
  apply yet.
- Reverting `origin/main` is out of scope for the coordinator (Article 1.1:
  no git merge/push) and risky regardless — the hotfix `9b89a6e5db`/mint
  `d79a4ff5f6` commits sit adjacent in the same history.
- Local `main` is 1 ahead (unpushed `4877bbb711`) / 26 behind `origin/main`;
  `main_sync_status_cli.bb` reads `action: wait-reconcile` — per that gate
  I do not merge by hand; the reconcile daemon owns non-ff joins.

## Expected resolution

QA is actively mid round-5 `qa-gather` on BL-1880 right now. Once it
reaches a clean pass and the land actually happens through the normal
gate, the resulting land-approval record will let `is_qa_ancestor.sh`
read this cleanly (close-out option 1) and the escalation stops re-firing
on its own. No further coordinator action taken this turn beyond the
upstream fix above.

By coordinator.
