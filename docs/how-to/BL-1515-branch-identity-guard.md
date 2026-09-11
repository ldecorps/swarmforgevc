# Branch-identity guard — BRANCH_DRIFT_DETECTED / BRANCH_DRIFT_REPAIRED (BL-1515)

## What triggered this

`.swarmforge/roles.tsv` names each role's branch by convention as its
session column (e.g. `swarmforge-coder`), and every guard that resolves a
role's branch reads it from there: `tree_collapse_guard_lib.bb`'s
`recipient-branch-ref`, and the operator's land recipe `git log
main..swarmforge-<role>`. From 2026-09-03 12:46:29 to 2026-09-10,
`.worktrees/coder` sat on a branch called `side` instead — the local ref
`refs/heads/swarmforge-coder` had been deleted entirely — and every one of
those guards silently degraded to "send allowed, unverified" or an empty
range against a ref that no longer existed. `ready_for_next.sh` ran clean
the whole time: [the BL-1195 worktree-drift guard](BL-1195-worktree-drift-guard.md)
compares tracked CONTENT to HEAD, and nothing compared the checked-out
BRANCH to the declared one. Nothing was lost — `side` was a strict
descendant of `origin/swarmforge-coder` — which is why this was a defect,
not an incident.

## What the guard does

`ready_for_next.bb` runs `enforce-branch-identity-guard!` before the inbox
is read, right beside the BL-1195 drift guard. It reads the role's declared
branch through the same accessor `tree_collapse_guard_lib.bb` uses
(`(:session (handoff-lib/load-role-info role root))`, BL-897 — so the two
can never drift apart), compares it to the actual checked-out branch, and
decides one of three outcomes:

- **`:ok`** — the checked-out branch already matches the declared one.
  Prints nothing, changes nothing.
- **`:repair`** — the one provably safe shape: the declared local branch is
  absent, AND either `origin/<declared>` doesn't exist or its tip is an
  ancestor of the checked-out branch's tip. The guard runs `git branch -m
  <actual> <declared>` (a rename never moves HEAD's commit) and prints:
  ```
  BRANCH_DRIFT_REPAIRED role=coder from=side to=swarmforge-coder at=c5c7ee3b49...
  ```
  then the turn continues normally.
- **`:refuse`** — everything else: the declared ref exists at a different
  tip, a detached HEAD, `origin/<declared>`'s tip is not an ancestor of the
  checked-out tip, or any git read fails. Nothing is touched — no rename,
  no checkout, no reset. The guard exits 2 and prints:
  ```
  BRANCH_DRIFT_DETECTED role=coder declared=swarmforge-coder actual=side declared_tip=absent actual_tip=c5c7ee3b49... reason=origin-tip-is-not-an-ancestor-of-the-checked-out-branch
  ```

A role with no `roles.tsv` row, or a row with no `:session`, is not judged
— unchanged from BL-1205's existing "no roles.tsv branch entry" posture.

## If you hit a refusal

Do not `reset` or `checkout` your way past it. The printed line names both
the declared and actual branch and both tips — that is the information a
human needs to decide which ref to keep. Report it (a `note`, priority
`00`, to specifier/coordinator) rather than working around it.

## Master-resident roles are exempt

The coordinator and specifier share one physical checkout (`master`), each
declaring its own `:session` branch name (`main`, or another) against that
single shared, actual branch. There is no single "declared branch identity"
for the checkout to be judged against, and a `:repair` verdict there would
rename the shared checkout's actual branch out from under every other
master-resident role and every guard elsewhere that assumes that name
exists. A hardener bounce (2026-09-11) found the first cut of this guard
missing that exemption; the fix skips the guard entirely whenever the
invoking role's `:worktree-name` is `"master"` — the same posture the
BL-1195 drift guard, `check_branch_namespace.bb`, `post_qa_branch_sweep_lib.bb`,
and `pre_qa_gate_gather_lib.bb` already take.

## The live repair

The coder's own worktree (`.worktrees/coder`) was on `side` at the time
this ticket was minted. With the guard lib landed, the coder ran the rename
by hand (`git branch -m side swarmforge-coder`) and then the guard itself,
confirming `git worktree list` shows `.worktrees/coder` on `swarmforge-coder`
at an unchanged tip, and that a second run is `:ok` (idempotent — no further
line printed). Full before/after `git worktree list` output and the guard's
own decision trace are recorded in
`backlog/evidence/BL-1515-coder-20260911.md`.

## Where it lives

| Piece | Location |
| --- | --- |
| Pure decision logic | `swarmforge/scripts/branch_identity_guard_lib.bb` — `decide`, `repaired-line`, `refusal-line` |
| Wiring (real git, master carve-out) | `swarmforge/scripts/ready_for_next.bb` — `enforce-branch-identity-guard!` |

Acceptance:
`specs/features/BL-1515-a-role-checkout-on-the-wrong-branch-is-caught-before-the-turn.feature`
