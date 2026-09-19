# check_standing_red_register.sh refuses a routine main-merge (ledger source)

## What happened

Doing `git merge main` in coder@2's worktree (main tip 8e9e190751, my
branch tip cf9579d941), the merge itself resolved with no conflicts, but
the commit was refused:

```
check_standing_red_register: COMMIT REFUSED - a standing-red row this
commit adds or changes names a ticket that is not open:
  - backlog/hardening-debt-ledger.yaml row for parcel 'BL-831' names
    BL-831, which is not open (closed or absent)
```

## Root cause

`swarmforge/scripts/check_standing_red_register.sh`'s ledger check (lines
106-119) resolves a `- parcel: X` row's ownership from ONLY that row's own
bare ticket id - it never checks whether `backlog/standing-reds.tsv`
already covers the same (lane, file) pair with a different, currently-open
owner, the way the guard's OWN allowlist check (lines 121-146) explicitly
does via the shared register join. Per
`docs/how-to/BL-1428-standing-red-register.md`, this indirection is by
design: "the deferral lives in the ledger row, as designed" (BL-1643's own
adjudication, `backlog/evidence/BL-1643-specifier-adjudication-of-unowned-hardening-row-20260919.md`)
- `backlog/standing-reds.tsv` line 41 already names BL-1643 (open, paused)
as owner of this exact (hardening, extension/out/bridge/bubblePipelinePage.js)
pair. The register CLI's own reader (`standing_red_register_lib.bb`)
honours that indirection; this commit guard's ledger branch does not.

Confirmed this only bites a MERGE commit, not main's own linear history:
`git show cf9579d941:backlog/hardening-debt-ledger.yaml | grep -c "parcel: BL-831"`
= 0 - my branch never had this row before. On main's own commit-by-commit
history the row was added while BL-831 was still open (2026-09-18) and
never touched again, so the guard's own "only judges what THIS commit
adds or changes" invariant (its header comment, invariant 2) held on
main's linear diffs. A branch merge collapses several days of main's
history into one `git diff --cached` against a single first parent,
making every already-valid-when-added line look newly "added" to this
commit - not the guard's stated intent, but its current behaviour.

## Impact

Any worktree role merging main today, after BL-831 closed
(2026-09-19T00:49Z) and while this ledger row and BL-1643's register
row both stand, hits the same refusal on its own next `git merge main`.
Not unique to coder@2.

## What I did

`git merge --abort`'d back to a clean cf9579d941 - no risk taken, no
`--no-verify` used. Escalating rather than hand-patching the guard script
(machinery, not my parcel) or hand-editing the ledger row (the
specifier's own ruling says that row must NOT change - "the deferral
lives in the ledger row, as designed").

## Blocked as a result

A stale coordinator Work-note for BL-1636 (already implemented, committed
fde1a2db6f, git_handoff'd to cleaner 2026-09-19T02:22:55Z, well before
this note's own dequeue at 02:24:25) needs `done_with_current.sh --no-work`
to close it out, and that command itself demands `merge main first` when
main has moved - which is this same blocked merge. Leaving the parcel
in_process rather than forcing it.

By coder.
