'use strict';

const fs = require('fs');
const os = require('os');

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

// BL-1897: with TMPDIR inside a git checkout (the ./tmp workflow rule), every
// fixture dir under it sits inside that checkout's work tree, and git
// discovery from the fixture finds the checkout: config.test.js's
// "non-git directory" bootstrap fixtures committed into QA's live branch (16
// commits on 2026-10-02, 29 files replayed onto main). GIT_CEILING_DIRECTORIES
// stops discovery before it climbs into os.tmpdir(), so a fixture is never
// part of the checkout that holds it, while a fixture that runs `git init`
// itself is still its own repository.

// Pure: the colon-separated ceiling `current` with `dirs` appended, keeping
// existing entries first, dropping empty entries and repeats (idempotent).
function ceilingDirectoriesWith(current, dirs) {
  const entries = [];
  for (const d of [...String(current || '').split(':'), ...dirs]) {
    if (d && !entries.includes(d)) entries.push(d);
  }
  return entries.join(':');
}

// Impure: adds `tmpdir` (default os.tmpdir()) and its real path to
// process.env.GIT_CEILING_DIRECTORIES, which every spawned git inherits. Git
// resolves a ceiling entry's symlinks itself. The real path is added too so
// that the ceiling never depends on that resolution.
function ceilGitDiscoveryAtTmpdir(tmpdir = os.tmpdir()) {
  let real = tmpdir;
  try {
    real = fs.realpathSync(tmpdir);
  } catch {
    /* a missing tmpdir has no real path to add */
  }
  process.env.GIT_CEILING_DIRECTORIES = ceilingDirectoriesWith(process.env.GIT_CEILING_DIRECTORIES, [tmpdir, real]);
}

module.exports = { stripAmbientGitDirRedirect, ceilingDirectoriesWith, ceilGitDiscoveryAtTmpdir };
