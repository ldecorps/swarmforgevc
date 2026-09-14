# BL-1565's own send is refused by the task-scope gate (coder, 2026-09-14)

## What happened

`swarm_handoff.sh ./tmp/handoff.txt` (task `BL-1565-...`, commit `d0a3809e40`)
was refused before the mailbox:

```
Cannot send git_handoff for BL-1565-a-git-handoff-to-the-coordinator-is-refused-at-send:
this task's own commits since its last handoff carry 2 paths
(specs/features/BL-1536-a-bounce-from-the-terminal-role-is-never-stamped-merge-only.feature,
specs/features/BL-950-qa-approval-carries-its-own-evidence-commit.feature)
belonging to BL-1536,BL-950, not to BL-1565 - the tip is entangled with
another ticket's work (BL-1192/BL-506). Rebuild or cherry-pick a tip-pure
commit for BL-1565 and re-send.
```

## Why the commit touches those two files

BL-1565 makes a git_handoff naming the coordinator refused categorically,
before `validate` ever runs. Two already-landed (`backlog/done/`) tickets'
feature files assert behaviour that is now unreachable as a direct,
mechanical consequence:

- `BL-1536-...feature`: two Examples rows asserted a QA-to-coordinator
  git_handoff still carries the terminal `non-forwarding: true` stamp.
  Retired (rows removed, narrative re-tensed), never reworded (BL-1006) -
  the same treatment the ticket's own text already directs for this file.
- `BL-950-...feature` (+ its step handler): every scenario asserting a
  QA-to-coordinator git_handoff's fate (refused for Article 4.4 reasons,
  or delivered) is now false - the new guard preempts
  `review_forward_evidence_gate_lib.bb` for that recipient entirely, for
  ANY commit. Retired down to the two scenarios that remain reachable
  (a bounce, a merge-up note). BL-806's own feature already covers the
  same-commit refusal, fail-open, and reroute_reason cases generically for
  non-coordinator recipients, so nothing is lost.

Both files are DONE tickets, so a `git_handoff` naming either as its own
task is refused too (`ticket-close-guard-lib`) - there is no route to land
these as their own separate parcels.

## What's needed

`task_scope_gate_lib.bb`'s sanctioned escape for exactly this shape (a
ticket that by construction retires another landed ticket's `.feature`
file) is a `retires:` field on the ticket's own YAML
(`declared-exempt-paths`, BL-1276's amendment - "a retirement ticket by
construction edits the SUPERSEDED ticket's .feature file... without this
the gate refuses a constitutionally mandated edit"). The specifier is the
one role that writes ticket YAML (Article 1.2); this is a request to add:

```yaml
retires:
  - specs/features/BL-1536-a-bounce-from-the-terminal-role-is-never-stamped-merge-only.feature
  - specs/features/BL-950-qa-approval-carries-its-own-evidence-commit.feature
```

to `backlog/paused/BL-1565-a-git-handoff-to-the-coordinator-is-refused-at-send.yaml`
(currently in `paused/`, not `active/`).

Everything else about the commit is unchanged and independently verified
green: the acceptance suite for BL-1565's own feature (9/9), BL-1536's
feature (5/5), BL-950's feature (2/2), the new shell test, the retired
BL-1536 shell test, the worktree-root shell test, and the property test
for the declared invariant.
