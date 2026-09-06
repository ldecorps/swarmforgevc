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
excluded by design). `handoffd` is the only runner — the manual CLI wrapper
was retired 2026-09-06 (BL-1426): it never parsed since its birth commit
(one unclosed paren), nothing ever called it, and it duplicated the
daemon's own role-fact supplier.

## What gets fast-forwarded

A role branch is **settled** (fast-forwarded to the landed commit) only when
all of the following hold, checked **in this order**:

| Check | If it fails → |
| --- | --- |
| `head-sha`/`landed-sha` both readable | `:skip` `:missing-ref` — logged, no tell |
| Head already at landed SHA | `:already-settled` — no-op |
| HEAD's containment of the landed commit is answerable (BL-1433) | `:skip` `:unknown-containment` — logged, no tell, never a guess |
| HEAD does NOT already contain the landed commit (BL-1433) | `:holds-landed` — logged, never surfaced, never told, whatever else the worktree holds |
| No parcel in `handoffs/inbox/in_process/` (BL-1421) | `:in-process-work` — surfaced to role, deferred, never woken |
| Worktree clean (`git status --porcelain` empty) (BL-1421) | `:dirty-worktree` — surfaced to role, woken |
| Branch can fast-forward to landed SHA | `:divergent-branch` — surfaced to role, deferred |

**A role whose HEAD already contains the landed commit is never told it is
behind, whatever else its worktree holds (BL-1433, invariant 1).** Before
this fix, a role that had merged `main` and started its own new work — 17
commits ahead of `origin/main`, 0 behind — still fell through to
`:divergent-branch` (`can-ff?` false, since it can't cleanly fast-forward
onto a commit its own history has already passed), and BL-1421's own
"caught up to the told sha" suppression was vacuously true for it (its HEAD
already contained the told sha), so the record never blocked a re-tell:
four roles received 61 identical "branch cannot fast-forward" notes in
fifteen minutes on 2026-09-05, the exact queue-clearing-blind hazard
BL-1384/BL-1422 exist to prevent. **`:divergent-branch` is now reachable
only for a HEAD that genuinely LACKS the landed commit and cannot
fast-forward** (invariant 2) — for that case BL-1421's standing-tell
suppression is meaningful again.

BL-1421's in-process-before-dirty ordering (in-process work is checked
before dirtiness — a role mid-parcel is dirty by definition, its own
uncommitted work, so checking dirtiness first always misclassified it as a
resolvable `:dirty-worktree` wake instead of the `:in-process-work` it
actually was) is unchanged, and now sits AFTER the `:holds-landed` check:
a dirty or mid-parcel worktree only reaches `:in-process-work` /
`:dirty-worktree` when its HEAD does not already contain the landed
commit — a role that merged main and is now dirty with its OWN new work is
`:holds-landed`, not `:dirty-worktree`, regardless.

The sweep **never** merges, rebases, stashes, or hard-resets. Non-ff branches
stay untouched; the role receives the usual QA merge-up note and resolves it
as receiver.

## Audit trail

State persists under `.swarmforge/daemon/post-qa-branch-sweep-state.json`:

- `landed-sha` — the `origin/main` commit the sweep targeted
- `settled` — map of role → SHA fast-forwarded; reset on every new landed
  sha (a role settled to the old landed sha needs re-checking against the
  new one anyway)
- `surfaced` — `[{:role :reason :told-sha}]`, one standing record per
  (role, reason) — the sha the role was told it was behind. **Survives a
  new landed sha (BL-1421):** before this fix the whole `:surfaced` record
  reset on every newly-landed commit, so a role that stayed behind while
  `main` landed 103 commits in a day was told again up to 103 times (539
  notes and tmux wakes across six roles on 2026-09-05). Now a record is
  cleared only when the role's own HEAD is confirmed to contain the
  `told-sha` (`caught-up-to-told?`, `git merge-base --is-ancestor <told-sha>
  HEAD` in the role's worktree) — a newer landed sha alone never re-tells or
  re-wakes a role that hasn't caught up yet.

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
  state sends nothing (invariant 2, no nudge storm). Since BL-1421,
  "already recorded" means the role's own HEAD has not yet caught up to the
  sha it was told about (`caught-up-to-told?`) — not merely "the landed sha
  hasn't changed" as it read before, which let every newly-landed commit
  count as a new surfacing regardless of whether the role had acted on the
  last one.
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
  worth a turn now. Since `decide-role` checks in-process work first
  (BL-1421, above), `:dirty-worktree` — and its wake — is only ever reached
  for a role with **no** parcel in in_process; a role mid-parcel is always
  `:in-process-work` (deferred) even though its own tree is dirty by
  definition. And since `:holds-landed` (BL-1433, above) is checked before
  either, none of this — wake or defer — is ever reached at all for a role
  whose HEAD already contains the landed commit; it is logged and left
  alone regardless of what its worktree holds.
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
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1421-one-standing-surfacing-per-role.feature
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1433-a-branch-that-holds-the-landed-commit-is-not-behind.feature
```

## Siblings

- BL-664 — turn-profiler measurement motivating deterministic transit assist
- BL-667 epic — deterministic transit assist umbrella
- BL-1361 — the surfaced-role send (this page's "A surfaced role is told,
  not just logged" section)
- BL-1421 — one standing surfacing per (role, reason) across landed shas,
  and in-process work checked before dirtiness (this page's "State persists"
  and "Wake vs. defer" sections)
- BL-1433 — a HEAD that already contains the landed commit is
  `:holds-landed`, never surfaced or told, checked before in-process/dirty;
  closes the gap BL-1421 left open (a role merely ahead of `origin/main`
  read as `:divergent-branch` forever, 61 notes to four roles in fifteen
  minutes) — this page's "What gets fast-forwarded" and "Wake vs. defer"
  sections
- BL-1360 — the hand-composed QA merge-up note; independent, same epic
- Pipeline diagram: `docs/diagrams/swarm-flow.mmd` (post-land sweep + surfaced merge-up notes)
