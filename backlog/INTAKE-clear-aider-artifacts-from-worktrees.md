# INTAKE: clear stray aider artifacts out of role worktrees

Requested by the operator 2026-09-10. Housekeeping only, no ticket needed -
route directly to each named role as a note (or have each pick it up on
its own next idle cycle) whenever it's next live.

## What to do

Yesterday's b.ai/GLM experiments ran `aider` directly in these role
worktrees. `aider` (run with `--no-gitignore`) drops its own session
artifacts as dotfiles in the CURRENT DIRECTORY it's invoked from - already
covered by the repo's own `.gitignore` (`.aider*`, line 27), so they're
not git noise, but they're real files cluttering the worktree on disk (one
`.aider.chat.history.md` in the main checkout was 3.1MB).

Confirmed present as of 2026-09-10 07:30 UTC in exactly these 5 worktrees
(NOT cleaner, NOT specifier, NOT art-director):

- `.worktrees/coder/.aider.chat.history.md`, `.aider.input.history`, `.aider.tags.cache.v4/`
- `.worktrees/documenter/` (same 3 names)
- `.worktrees/hardender/` (same 3 names)
- `.worktrees/architect/` (same 3 names)
- `.worktrees/QA/` (same 3 names)

Each affected role: move its own worktree's 3 items into
`.swarmforge/runtime/aider-artifacts-archive/<role-name>/` (create the
directory if absent) - e.g. from `.worktrees/coder/`:

```
mkdir -p /home/carillon/swarmforgevc/.swarmforge/runtime/aider-artifacts-archive/coder
mv .aider.chat.history.md .aider.input.history .aider.tags.cache.v4 \
   /home/carillon/swarmforgevc/.swarmforge/runtime/aider-artifacts-archive/coder/
```

Archived, not deleted, since these are the only record of what aider
actually said/did during yesterday's trials - worth keeping somewhere
that isn't the middle of the worktree, not worth deleting outright.

This is a plain file move, not a commit - nothing here touches git, no
pipeline-code guard applies, and it does not need a ticket, evidence
file, or QA pass. Any role can do this as its very first action next
time it's live, before `ready_for_next.sh`.
