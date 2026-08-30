# BL-1240 — send blocked: task_scope_gate false-positive on a stale revert commit

Documenter, 2026-08-30.

## What's blocking the forward

Documentation for this parcel is complete and unchanged since my earlier
pass (the "Unregistered-Test Send-Time Gate" section in
`swarmforge/handoff-protocol.md`, `docs/how-to/BL-1240-unregistered-test-send-time-gate.md`,
and the `docs/reference/Specification.MD` entry all still describe the
shipped behavior correctly; the round-2 coder/hardener rework only touched
`extension/test/helpers/pinnedRepoFixture.js` test-fixture plumbing, no
user-visible change). After merging hardener's `1c20326eaa` into this
worktree (`83f594cf84`), `swarm_handoff.sh` refuses the `git_handoff` to QA:

```
HANDOFF INVALID
- Cannot send git_handoff for BL-1240-...: this task's own commits since
  its last handoff carry a path (docs/how-to/BL-973-bb-fixture-closure-
  guards-and-suite-inventory.md) belonging to BL-973, not to BL-1240 - the
  tip is entangled with another ticket's work (BL-1192/BL-506).
```

## Root cause

`task_scope_gate_lib.bb`'s `last-handoff-commit` resolves BL-1240's base to
`a716330d9c` (cleaner's forward to architect) — confirmed via:

```
bb -e '(load-file "swarmforge/scripts/task_scope_gate_lib.bb")
       (println (#'"'"'task-scope-gate-lib/last-handoff-commit "." "BL-1240"))'
=> a716330d9c
```

That commit is a genuine ancestor of the current tip, not abandoned, so
`abandoned_commits` cannot help here (it only overrides the walk's base to
`origin/main` when the base itself is listed as abandoned — see BL-1224's
documented remedy; this is a different situation).

Walking `a716330d9c..HEAD --first-parent` and filtering commits whose
SUBJECT names BL-1240 finds exactly two:

- `83f594cf84` — my own merge of hardener's tip. Its first-parent diff is
  empty for foreign paths (confirmed via `git diff-tree --no-commit-id
  --name-only -r --first-parent 83f594cf84` — no BL-973 hit).
- `3825f91cd2` — `Revert "Merge documenter BL-1240 0ca3bc03c0 into QA. By
  QA."`, from the QA bounce/revert cycle earlier this same day. Its subject
  contains the literal text "BL-1240" (inherited from the reverted commit's
  own subject), so `extract-ticket-id` matches it as a BL-1240 commit. Its
  diff (undoing the earlier merge) removes the lines I had added to
  `docs/how-to/BL-973-bb-fixture-closure-guards-and-suite-inventory.md` (a
  legitimate, untagged cross-link commit, `c393e35b0`, added earlier and
  re-present in the tree today) — so the gate reads that revert as "BL-1240
  touching BL-973's file" and blocks.

This is a gate defect, not a documentation defect: a revert-of-merge commit
inherits its reverted commit's ticket-tagged subject, and the gate cannot
tell "this commit undoes a previous change" from "this commit newly touches
foreign scope." `abandoned_commits` only rewrites the walk's *base*, and
this revert sits strictly inside the current (non-abandoned) base's range,
so no ticket-YAML field can exempt it.

## What I did not do, and why

I did not edit `task_scope_gate_lib.bb` (swarm machinery, outside doc
domain) and did not force the handoff by any other means — none exists on
this path. Filed as a `note` (priority 00) to specifier and coordinator
rather than forwarding a refused `git_handoff` or silently working around
the gate.

## Current state

Documentation is complete and correct; the parcel remains in_process at
documenter pending adjudication of the gate false-positive.
