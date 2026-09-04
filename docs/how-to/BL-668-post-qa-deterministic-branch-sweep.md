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

## A surfaced role is told, not just logged (BL-1361)

BL-668 shipped "surfaced to its role" as a log line only —
`record-surface!` appended to the state file and nothing else sent. Counted
against the daemon logs on 2026-09-03: 125 `post-qa-branch-sweep-surfaced`
events against 3 `post-qa-branch-sweep-settled`, and not one role was ever
told. BL-1361 adds the send, reusing the daemon's existing
`swarm_handoff.bb` path rather than writing a mailbox directly
(`post-qa-branch-sweep-tell!`, `swarmforge/scripts/handoffd.bb`).

- **What triggers it**: only a *new* surfacing — `sweep-one-role` returns an
  action only when `surface-already-recorded?` was false, so the existing
  surfaced record stays authoritative and a per-tick re-sweep of the same
  state sends nothing (invariant 2, no nudge storm).
- **Message**: a one-liner within the 80-char note cap — the short landed
  SHA, the surfacing reason, and "merge up" (`surface-notice`,
  `post_qa_branch_sweep_lib.bb`). A note over the cap quarantines silently
  as `.dead`, which is exactly the "surfacing nobody hears" defect this
  ticket exists to end — the notice is truncated to fit rather than risk
  that.
- **Wake vs. defer** (human ruling 2026-09-04, `wake-for-reason?`): only
  `:dirty-worktree` wakes the role immediately. `:divergent-branch` and
  `:in-process-work` are told but deferred —
  `SWARMFORGE_SKIP_SYNC_INJECT=1` on the `swarm_handoff.bb` call — because a
  divergent branch is merged anyway the next time that role receives a
  parcel (a forwarded commit must carry the received commit as an
  ancestor), so waking for it would spend a turn on something the role gets
  for free. A dirty worktree does not resolve itself and is the one reason
  worth a turn now.
- **One unreachable mailbox never withholds the rest** (invariant 3): the
  `tell!` call is wrapped so a thrown exception or a non-zero `swarm_handoff`
  exit is caught, logged as `post-qa-branch-sweep-tell-failed`, and the
  `reduce` over roles continues — the roles after the failing one still get
  told.
- **Still ff-only**: none of this changes what the sweep does to a branch.
  A surfaced worktree is still left byte-identical; only who hears about it
  changed.

| Log event | Meaning |
| --- | --- |
| `post-qa-branch-sweep-told` | Send succeeded; third field is `woken` or `deferred` |
| `post-qa-branch-sweep-tell-failed` | Send failed; role stays surfaced, sweep continues |

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
bash swarmforge/scripts/test/test_bl1361_sweep_tells_roles.sh
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-668-post-qa-deterministic-branch-sweep.feature
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1361-the-sweep-tells-the-roles-it-could-not-settle.feature
```

## Siblings

- BL-664 — turn-profiler measurement motivating deterministic transit assist
- BL-667 epic — deterministic transit assist umbrella
- BL-1361 — the surfaced-role send (this page's "A surfaced role is told,
  not just logged" section)
- BL-1360 — the hand-composed QA merge-up note; independent, same epic
- Pipeline diagram: `docs/diagrams/swarm-flow.mmd` (post-land sweep + surfaced merge-up notes)
