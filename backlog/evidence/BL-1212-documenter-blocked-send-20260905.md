# BL-1212 documenter — blocked send, 2026-09-05

## Symptom

`swarm_handoff.sh` refuses `git_handoff` for `BL-1212-real-tree-docs-gate-never-recorded-its-live-read-exemption`
at every commit tried, with the task-scope gate (BL-1192/BL-506):

```
Cannot send git_handoff for BL-1212-...: this task's own commits since
its last handoff carry 2 paths (backlog/paused/BL-1435-a-rev-parse-root-is-a-live-read.yaml,
specs/features/BL-1435-a-rev-parse-root-is-a-live-read.feature) belonging
to BL-1435, not to BL-1212 - the tip is entangled with another ticket's
work (BL-1192/BL-506). Rebuild or cherry-pick a tip-pure commit for
BL-1212 and re-send.
```

## Root cause

`ea6628d01e` — "Merge main into swarmforge-architect: pick up BL-1212
scenario-02 retirement (BL-1435 mint)" — is a routine main-sync merge
whose subject names BL-1212 (per the known hazard: "Never name a ticket
in a main-sync merge subject — trips the scope gate"). Its own combined
(`--authored`) diff carries BL-1435's mint files (a rename/move the
combined-diff heuristic reads as delete+add), so the task-scope gate's
walk — which unions every commit's own diff whose message names this
task, from the last handoff to the cited commit — flags it every time,
regardless of which later commit is cited, because the offending commit
is itself in that walked range and its own diff is being unioned in,
not the net working-tree state.

## What I tried

1. Sent the real chain tip (`c7c136b464`, full role lineage from
   coder→cleaner→architect→hardender→documenter): task-scope gate
   refusal above.
2. Rebuilt a tip-pure replay off current `main` (`6af9d14e87`, only
   BL-1212's own 7 files, confirmed via `git diff main..HEAD` before
   the rebuild that BL-1435's files are byte-identical to `main` already
   — nothing of BL-1435's was lost or altered): got the SAME task-scope
   entanglement message, AND a new set of `pre_qa_gate` ancestry failures
   ("stranded" on every role's worktree) because this commit does not
   descend from the coder/cleaner/architect/hardender commits — it
   breaks the "forwarded commit must carry the received commit as an
   ancestor" rule.
3. Read `task_scope_gate_lib.bb`'s own `abandoned_commits` override
   (BL-1192 architect bounce round 2 D1): recording the prior base as
   `abandoned_commits:` on the ticket YAML restarts the walk from
   `origin/main` instead of the old base — the documented escape hatch
   for exactly this "deliberate rebuild-off-main" shape. Before
   committing to that path (which trades away real per-role commit
   lineage for BL-1212, a decision with QA/audit-trail consequences I
   don't think is mine to make unilaterally), stopped to raise it here
   rather than force it through.

## What I did NOT do

I did not rewrite, rebase, or alter `ea6628d01e` itself — it is already
shared history other roles (cleaner, hardender) have built on top of, and
rewriting it would be exactly the destructive shared-history hazard the
constitution warns against.

## Current repo state

`swarmforge-documenter` is clean, at `c7c136b464` (the full-lineage tip,
unchanged, review evidence and docs already committed). No `git_handoff`
has been sent for this task. Nothing is lost — this evidence file and my
completed review (docs, evidence) are all present on this branch, just
not yet forwarded.

## Ask

Either:
(a) confirm recording `abandoned_commits: [eb32d85d70]` (or whichever sha
    the durable handoff archive names as this task's last-forwarded
    commit) on `BL-1212`'s own YAML and re-sending a from-`main` rebuild
    is the right call, accepting that BL-1212's landed history will not
    show the coder/cleaner/architect/hardender commits in its own
    ancestry (their evidence files are preserved via `git checkout <path>`
    into the rebuild, just not their commit objects), or
(b) name a different remedy for the entangled `ea6628d01e` merge subject.
