# BL-105 runbook: strip the oversized blob from role-branch history

## Background

The BL-093 hardening commit grew `extension/stryker-incremental.json` to
113.69 MB. GitHub rejects any push whose reachable objects include a file
over 100 MB, so a true (`--no-ff`) merge of any branch still carrying that
commit in its ancestry is unpushable to `main`.

Containment applied on 2026-07-05: BL-093 was **squash-merged** into `main`
(content identical, ancestry excluded — the offending commit and its blob
never reached `main`'s history). Every role branch (coder, cleaner,
architect, hardender, documenter, QA) still carries the blob commit in its
own local history, so until this runbook is executed the specifier must
keep squash-merging every QA approval instead of resuming `--no-ff` merges.

This runbook removes that blob from every local ref so full merges can
resume. It does **not** touch `origin` — origin never received the blob,
so no remote rewrite is needed.

## Preconditions (all must hold before starting)

- [ ] All roles are **idle**: no `in_process` handoff in any worktree's
      inbox, and no backlog item in `backlog/active/`.
- [ ] The coordinator has scheduled the window and told every role pane to
      stop (no wake-ups will arrive mid-procedure).
- [ ] `git-filter-repo` is installed and on `PATH` (`pip install
      git-filter-repo` or the OS package). This is a maintenance-time tool,
      not a swarm dependency — it is not added to the pinned tool table in
      `swarmforge/constitution/articles/engineering.prompt`.
- [ ] A full backup of the repo directory (the whole working copy, `.git`
      included) exists before starting. History rewrites are destructive;
      the backup is the rollback path if anything goes wrong.

## Procedure

Run every step from the **main working copy** (not a role worktree). Linked
worktrees share the one physical `.git`, so the rewrite affects all of them
at once — that is why every role must be idle first.

1. **Identify every ref that needs rewriting** (every role branch plus any
   tags that might carry the blob commit):

   ```sh
   git for-each-ref --format='%(refname)' refs/heads/ refs/tags/
   ```

2. **Strip the path from every ref's history**, in a single pass so all
   branches stay consistent with each other:

   ```sh
   git filter-repo --path extension/stryker-incremental.json --invert-paths --force
   ```

   `--force` is required because `filter-repo` refuses to run against a
   repo it judges "not freshly cloned" by default; this is expected here
   since we are intentionally rewriting an existing checkout in place.

3. **Verify no oversized object remains reachable from any local ref**:

   ```sh
   git rev-list --objects --all \
     | git cat-file --batch-check='%(objecttype) %(objectname) %(rest) %(objectsize)' \
     | awk '$1 == "blob" && $4 > 100*1024*1024 { print }'
   ```

   This must print nothing. (BL-105 hygiene-01.)

4. **Reset every role worktree onto its rewritten branch**. `filter-repo`
   rewrites the branch tips in the shared `.git`, but each worktree's
   checked-out files and index are stale until refreshed:

   ```sh
   for wt in coder cleaner architect hardender documenter QA; do
     git -C ".worktrees/$wt" reset --hard "swarmforge-$wt"
     git -C ".worktrees/$wt" status --short   # expect empty
   done
   ```

   Confirm every worktree reports a clean status before proceeding.

5. **Confirm `.gitignore` carries the entry** (it already does on `main`
   as of the BL-093 containment; the rewrite does not remove committed
   files from disk, only from history — the untracked, gitignored file on
   disk keeps working for stryker's incremental cache):

   ```sh
   grep -qx 'extension/stryker-incremental.json' .gitignore || \
     echo 'extension/stryker-incremental.json' >> .gitignore
   ```

6. **Resume full merges.** Once every worktree is confirmed clean on its
   rewritten branch, tell the specifier the temporary squash-merge policy
   has ended — it returns to `--no-ff` merges for every subsequent QA
   approval. Record this explicitly in the ticket's completion note (BL-105
   itself requires this).

7. **Rehearse once before the real window** (BL-105's non-behavioral gate):
   run steps 1–5 against a throwaway clone of the repo first, and confirm
   step 3's check passes and step 4's worktrees end up clean, before
   running the procedure against the real repo.

## Stryker incremental mode after the rewrite

`extension/stryker-incremental.json` is gitignored, not deleted from disk.
Stryker's `--incremental` flag reads/writes it as a local, untracked file
in each worktree exactly as before; nothing about incremental mode changes
except that the file itself never enters `git status` or a commit again.
If a worktree's on-disk cache is missing (e.g. a fresh worktree checkout),
stryker seeds a new one on its next incremental run — there is no seeding
step to perform manually.

## After this runbook

The size guard (`swarmforge/scripts/check_commit_size.sh`, installed
repo-wide as a `pre-commit` hook via `core.hooksPath` — see
`ensure_commit_size_guard` in `swarmforge/scripts/swarmforge.sh`) rejects
any future commit introducing a file over 50 MB, naming the file and its
size, so this class of incident cannot recur silently.
