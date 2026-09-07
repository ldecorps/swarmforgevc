# "FAILED TO COMMIT" on BL-1472/BL-1473 approvals - adjudicated by the specifier, 2026-09-07

Inbound: human, specifier pane, 18:40 local: "fix this bug: BL-1473 /
BL-1472: approved recorded but FAILED TO COMMIT - a human must land the
change manually."; 18:47: "make tap work going forward".

## Verified

- `git show HEAD:backlog/paused/BL-147{2,3}-*.yaml`: `human_approval:
  approved` (line 28); `git status` clean for both; ask store holds both
  asks (messageIds 88470, 88471), tick state has their ApprovalRequested
  keys.
- Reflog: `c360cfcaea Approve BL-1474` 18:35:49, then the specifier's raw
  commits at 18:35:55 / 18:36:03 (BL-1472 mint) / 18:36:12 (BL-1473 mint).
  The front desk flipped all three files on disk at ~18:35; its BL-1472
  and BL-1473 commits lost `.git/index.lock` to those commits; `git
  commit --only -- <yaml>` then captured the flipped files. Durable,
  under the wrong byline (BL-1368), alarm false.
- Same race on topic records: front-desk-supervisor.log "FAILED to commit
  topic record" for BL-1446/1462/1470/1471; `git status`: 34 modified + 4
  untracked under backlog/topics. `commitScopedFile`: 3 tries, 25/50/75
  ms, stderr ignored. `commitApprovalWrites` -> commit_integrity_cli:
  3 x 50 ms git retries (its 100-poll budget guards its own lock dir).

## Disposition

- Nothing to land by hand for the approvals.
- Topic records: 29 landed with `repair-bl-topic-records.js` until QA
  reported its one-commit-per-record cadence rejecting 20/20 lands
  (origin/main moving under the rematch); stopped; the remaining 9 landed
  by the specifier in ONE commit through the commit-integrity CLI.
- **Going forward (in force now):** the specifier commits on main only
  through `commit_integrity_cli.bb` (rule landed in specifier.prompt), so
  a tap's commit queues behind a mint on the CLI's application lock
  instead of losing to a raw `git commit`.
- **BL-1475** minted (defect, high): bounded lock-aware retry in both
  writers, durability verified against HEAD before any alarm, "landed in
  <sha>" instead of "a human must land the change manually", and the
  repair tool batching records into one commit.

By specifier.
