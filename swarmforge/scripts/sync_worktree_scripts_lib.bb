;; BL-373: pure decision logic for "should the launcher's worktree-scripts
;; sync overwrite this particular path". Loaded via load-file, not required
;; on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "sync_worktree_scripts_lib.bb")))
;; and referred to as sync-worktree-scripts-lib/foo.
;;
;; ROOT CAUSE (the "phantom revert", 6 occurrences on 2026-07-14 across four
;; worktrees). swarmforge.sh's sync_worktree_scripts() ran an unconditional
;; `cp -R` of the LAUNCHING checkout's swarmforge/scripts/ and
;; swarmforge/profiles/ over every role worktree's own copy, on EVERY
;; launch. In this self-hosted repo those paths are git-tracked - only
;; .swarmforge/ is gitignored - so the copy silently overwrote tracked
;; branch content with master's (often older) bytes, entirely outside git.
;; A script change merged onto a role branch but not yet landed on main was
;; therefore reverted in the working tree at every relaunch: byte-identical
;; to the pre-ticket commit (the copy's source WAS that commit), never seen
;; in the master checkout (the sync loop skips the working dir), untracked
;; new files surviving (cp -R only overwrites what the source has).
;;
;; THE INVARIANT. The sync is not gratuitous - a foreign TARGET repo does
;; not carry swarmforge/ at all and genuinely needs the scripts copied in
;; to be runnable. What separates the two cases is one sentence: never
;; overwrite a path the destination worktree's OWN git index tracks. Where
;; git owns the content, git already delivers it (the role's branch has
;; it); where git does not, the copy is the only delivery mechanism and
;; must keep working.

(ns sync-worktree-scripts-lib)

(defn should-copy?
  "Should the sync copy this one file into the destination worktree? Never
   when the worktree's own git index already tracks it at that path -
   `tracked-paths` is the destination worktree's `git ls-files` output
   (repo-relative paths, e.g. \"swarmforge/scripts/handoffd.bb\"),
   `dest-relative-path` is the same-shaped repo-relative path this file
   would land at."
  [{:keys [tracked-paths dest-relative-path]}]
  (not (contains? (set tracked-paths) dest-relative-path)))
