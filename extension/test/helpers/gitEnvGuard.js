'use strict';

// BL-1196: GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE inherited from an ambient
// shell silently redirect ANY `git -C <cwd>` spawn onto whatever repo those
// vars name, regardless of cwd - the exact shape that corrupted
// swarmforge-hardender (backlog/evidence/hardener-branch-corruption-20260827.md)
// and a property fixture's own live-repo write the same day.
// sharedRepoFixture.js's gitIn already strips the first two per-spawn
// (BL-1039), but ~60 other test files define their own local, unguarded
// `git(cwd, args)` with no env override. This is the pure strip logic;
// gitEnvGuardSetup.js calls it once at module load (same split as
// envRestoreGuard.js/envRestoreGuardSetup.js).
//
// AMENDED 2026-08-28: GIT_INDEX_FILE joins the stripped set. Git exports it
// (alongside GIT_DIR, absolute; GIT_WORK_TREE unset) into every hook it
// runs for a commit made from a linked worktree - the ambient source turned
// out to be git itself, not a stray operator shell, and GIT_INDEX_FILE is
// the only one of the three set at all in the master-checkout presentation
// of the same defect. Widened per the original out_of_scope's own stated
// condition ("widen only if a future incident actually implicates one") -
// this incident does.

// Impure: deletes GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE from
// process.env if present. Idempotent - a repeat call with none set is a
// harmless no-op.
function stripAmbientGitDirRedirect() {
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;
  delete process.env.GIT_INDEX_FILE;
}

module.exports = { stripAmbientGitDirRedirect };
