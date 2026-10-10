'use strict';

// BL-2116: shared non-vacuity probe helper. Every probe site that needs to
// run a deliberately broken copy of a script must use this module so that:
//   - the broken copy lives under a temporary root (never under the checkout)
//   - the temporary root is symlinked around so relative loads resolve
//   - a dead child's root is reaped by the next probe run
//
// API:
//   createScratchRoot(prefix) -> { root, cleanup }
//   writeBrokenCopy(root, realPath, transform) -> brokenPath
//
// prefix: the owning-pid prefix used by tmpDir.js's sweepStaleTmpDirs
//   (e.g. 'bl1652-non-vacuity-') so that sweepStaleTmpDirs can key on the
//   pid segment and only reap roots whose owner is dead.

const fs = require('fs');
const path = require('path');
const tmpDir = require('./tmpDir.js');

// Reap any temp root whose recorded owner pid is dead before we create a
// new one. sweepStaleTmpDirs expects a prefix that begins the directory
// name; the prefix here is the full probe name (e.g. 'bl1652-non-vacuity-')
// and sweepStaleTmpDirs will match <prefix><pid>-...
function preSweep(prefix) {
  tmpDir.sweepStaleTmpDirs({ prefix });
}

// Create a temporary root using mkProcessTmpDir (process-lifetime, removed
// on exit) after sweeping any stale roots with the same prefix. Returns
// { root, cleanup } where cleanup removes the root.
function createScratchRoot(prefix) {
  preSweep(prefix);
  const root = tmpDir.mkProcessTmpDir(prefix);
  return {
    root,
    cleanup() {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

// Write a broken copy of a script under the scratch root and return its
// path. The broken copy is at root/<realPath> where realPath is the path
// relative to the repo root (e.g. 'swarmforge/scripts/chase_sweep.bb').
// transform(originalText) returns the broken text.
//
// Before writing, symlinks every ancestor directory from the copy's
// directory up to the repo root so that relative loads (fs/parent,
// ".." loads, Node require) resolve to the real tree.
function writeBrokenCopy(root, realPath, transform) {
  // realPath is relative to the repo root; resolve it.
  // __dirname is extension/test/helpers/, so go up 5 levels to reach the worktree root.
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const realFile = path.join(repoRoot, realPath);
  const originalText = fs.readFileSync(realFile, 'utf8');
  const brokenText = transform(originalText);

  // Determine where the broken copy will live under root.
  const relativeDir = path.dirname(realPath); // e.g. 'swarmforge/scripts'

  // Symlink every ancestor directory from the copy's directory up to the
  // repo root. Walk from the copy's directory up, creating symlinks.
  const parts = relativeDir.split(path.sep);
  let symlinkPath = root;
  for (let i = 0; i < parts.length; i += 1) {
    const dirName = parts[i];
    const realAncestor = path.join(repoRoot, ...parts.slice(0, i + 1));
    const targetPath = path.join(symlinkPath, dirName);
    if (!fs.existsSync(targetPath)) {
      // Create parent first (if not already a symlink)
      const parentPath = path.dirname(targetPath);
      if (!fs.existsSync(parentPath)) {
        fs.mkdirSync(parentPath, { recursive: true });
      }
      // Create a symlink to the real ancestor.
      fs.symlinkSync(realAncestor, targetPath);
    }
    symlinkPath = targetPath;
  }

  // Write the broken copy into the symlinked directory tree.
  const brokenPath = path.join(symlinkPath, path.basename(realPath));
  fs.writeFileSync(brokenPath, brokenText);
  return brokenPath;
}

module.exports = {
  createScratchRoot,
  writeBrokenCopy,
};
