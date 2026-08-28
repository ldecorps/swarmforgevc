'use strict';

// BL-1196: GIT_DIR/GIT_WORK_TREE inherited from an ambient shell silently
// redirect ANY `git -C <cwd>` spawn onto whatever repo those vars name,
// regardless of cwd - the exact shape that corrupted swarmforge-hardender
// (backlog/evidence/hardener-branch-corruption-20260827.md) and a property
// fixture's own live-repo write the same day. sharedRepoFixture.js's gitIn
// already strips both per-spawn (BL-1039), but ~60 other test files define
// their own local, unguarded `git(cwd, args)` with no env override. This is
// the pure strip logic; gitEnvGuardSetup.js calls it once at module load
// (same split as envRestoreGuard.js/envRestoreGuardSetup.js).

// Impure: deletes GIT_DIR and GIT_WORK_TREE from process.env if present.
// Idempotent - a repeat call with neither var set is a harmless no-op.
function stripAmbientGitDirRedirect() {
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;
}

module.exports = { stripAmbientGitDirRedirect };
