# Post-QA deterministic branch sweep (BL-668)

*How-to. Task-oriented: understand how clean role branches fast-forward after
QA lands on `main`, and when a role still receives a merge-up note.*

After QA integrates an approved parcel onto `origin/main`, every pipeline role
used to need an LLM merge-up turn (~10 minutes each per BL-664 measurement)
even when the update was a trivial fast-forward. BL-668 automates the
mechanical case: a deterministic sweep fast-forwards **clean** role branches
in their own worktrees — no merge, rebase, stash, or reset.

## When it runs

`handoffd` invokes `post-qa-branch-sweep-sweep!` on the same cadence as other
post-land chores (shares the `post-qa-branch-sweep` sweep slot). It reads the
landed `origin/main` SHA and visits every pipeline role registered in
`.swarmforge/roles.tsv` except `coordinator` and `specifier` (merge-up
excluded by design).

Manual invocation:

```bash
bb swarmforge/scripts/post_qa_branch_sweep.bb <project-root>
# or
bash swarmforge/scripts/post_qa_branch_sweep.sh <project-root>
```

## What gets fast-forwarded

A role branch is **settled** (fast-forwarded to the landed commit) only when
all of the following hold:

| Check | If it fails → |
| --- | --- |
| Worktree clean (`git status --porcelain` empty) | `:dirty-worktree` — surfaced to role |
| No parcel in `handoffs/inbox/in_process/` | `:in-process-work` — surfaced to role |
| Branch can fast-forward to landed SHA | `:divergent-branch` — surfaced to role |
| Head already at landed SHA | `:already-settled` — no-op |

The sweep **never** merges, rebases, stashes, or hard-resets. Non-ff branches
stay untouched; the role receives the usual QA merge-up note and resolves it
as receiver.

## Audit trail

State persists under `.swarmforge/daemon/post-qa-branch-sweep-state.json`:

- `landed-sha` — the `origin/main` commit the sweep targeted
- `settled` — map of role → SHA fast-forwarded
- `surfaced` — roles skipped with `:dirty-worktree`, `:in-process-work`, or
  `:divergent-branch`

A second sweep against the same landed SHA is a no-op for already-settled
branches (scenario BL-668 rerun-noop-05).

## Modules

| Piece | Location |
| --- | --- |
| Pure sweep logic | `swarmforge/scripts/post_qa_branch_sweep_lib.bb` |
| CLI wrapper | `swarmforge/scripts/post_qa_branch_sweep.bb`, `post_qa_branch_sweep.sh` |
| handoffd hook | `swarmforge/scripts/handoffd.bb` — `post-qa-branch-sweep-sweep!` |
| Role worktree resolution | `.swarmforge/roles.tsv` (never hardcoded paths) |

## Verify

```bash
bb swarmforge/scripts/test/post_qa_branch_sweep_lib_test_runner.bb
bb swarmforge/scripts/test/post_qa_branch_sweep_cli.bb
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-668-post-qa-deterministic-branch-sweep.feature
```

## Siblings

- BL-664 — turn-profiler measurement motivating deterministic transit assist
- BL-667 epic — deterministic transit assist umbrella
