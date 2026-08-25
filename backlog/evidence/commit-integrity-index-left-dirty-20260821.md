# commit_integrity_cli: index-left-dirty on rename commits (2026-08-21, coordinator)

Two independent occurrences today, both `git mv <paused|active>/... -> <active|done>/...`
renames committed via `commit_integrity_cli.bb --path <old> --path <new>`:

1. **BL-621 close** (`active/` -> `done/`): first attempt returned
   `{"success":false,"reason":"commit-failed","attempts":1,"index-left-dirty":true}`.
   Post-failure `git status` showed a SPLIT state: the old path staged as a
   plain delete (`D`) but the new path back to untracked (`??`) — not the
   clean pre-call staged-rename it should have restored to. Manual
   `git add <old> <new>` re-collapsed it to a staged rename, then a bare
   retry of the same CLI call succeeded (sha `b5c80459`).
2. **BL-1025 promote** (`paused/` -> `active/`), via `promote_and_route_next.sh`:
   same `commit-failed`/`index-left-dirty:true`, this time the process also
   left a transient `.git/index.lock` (gone by the time it was inspected —
   likely the failed `git commit` invocation's own lock, not a second
   concurrent writer; another shell in this session was running vitest in
   `.worktrees/coder`, a separate worktree, not this checkout). A bare retry
   of the CLI call (no manual fixup needed this time beyond the lock having
   already cleared) succeeded (sha `d5dd8dc0`).

Not investigated further (out of coordinator's remit — no production code
authored here). Looks adjacent to BL-856 ("failed integrity commit leaves
work staged") but distinct: BL-856 was about a failed commit leaving work
staged-but-uncommitted; this is the RESTORE path itself failing on a
rename specifically, leaving a split delete/untracked pair rather than a
clean staged rename. Flagged via `note` (priority 10) to specifier to mint
a defect ticket.

By coordinator.
