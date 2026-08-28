'use strict';

// BL-1230: a `.git` directory is the one artifact git will never report -
// not tracked, not untracked, invisible to `git status` and `git clean`.
// A fixture that ran `git init` with its cwd set to a real directory of the
// repository (backlog/.git, 2026-08-27) leaves that artifact behind, and
// every git command run with a cwd under it silently resolves to the leaked
// repo instead of the working tree root. This guard walks the tree looking
// for exactly that: a `.git` DIRECTORY nested somewhere other than the
// working tree's own root.
//
// Report only - never deletes, moves, or rewrites what it finds (the swarm's
// own never-delete-what-you-did-not-create rule; a human removes a leak).
//
// Exempt BY CONSTRUCTION, never by naming a known leak path:
//   - the working tree's own root .git - not "nested", it is what makes the
//     tree a repository at all.
//   - `.git` as a FILE rather than a directory (a linked worktree's gitfile,
//     e.g. .worktrees/<role>/.git, or a submodule reference) - git itself
//     writes these, and only a real directory redirects git's cwd resolution
//     the way a leaked `git init` does.
//   - anything under a `node_modules` directory - vendored packages may
//     legitimately ship their own `.git`, and it is no more this repository's
//     concern than the rest of node_modules' contents are.
//   - the contents of `.worktrees/` (a linked worktree's FULL checkout, not
//     merely its own gitfile) - each worktree already runs this same guard
//     against its own root; descending into every linked worktree's entire
//     tree from another checkout is the exact "cost grows with repo size"
//     shape BL-1038 exists to refuse, multiplied by however many worktrees
//     the repo happens to have at the time (BL-1039 wire-of-refs family).
const fs = require('fs');
const path = require('path');

const SKIP_DIR_NAMES = new Set(['node_modules', '.worktrees']);

/**
 * Every `.git` directory nested under root, other than root's own. Does not
 * descend into node_modules (a whole vendored subtree, exempt by
 * construction) or into any directory it reports (a leaked repo's own
 * internals are not this guard's business).
 *
 * `readdir` is an injectable seam (defaults to `fs.readdirSync`) so tests can
 * simulate an unreadable directory without real filesystem permissions, and
 * (BL-1230 D1, architect bounce) so the property test can generate arbitrary
 * tree layouts and assert both declared invariants without touching the
 * real filesystem.
 */
function findNestedGitRepositories(root, { readdir = fs.readdirSync } = {}) {
  const violations = [];
  walk(root, root, violations, readdir);
  return violations;
}

function walk(root, dir, violations, readdir) {
  let entries;
  try {
    entries = readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory - nothing to report, nothing to crash on
  }
  for (const entry of entries) {
    if (entry.name === '.git') {
      const full = path.join(dir, entry.name);
      if (full === path.join(root, '.git')) {
        continue; // the working tree's own repository - not a leak
      }
      if (entry.isDirectory()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        violations.push({
          path: rel,
          reason: `a git command run with its cwd under ${rel} resolves to this nested repository, not the working tree root`,
        });
      }
      // A `.git` FILE (worktree gitfile / submodule reference) is exempt by
      // construction - git itself writes these, never a leaked `git init`.
      continue; // never descend into a repository (leaked or legitimate)
    }
    if (SKIP_DIR_NAMES.has(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      walk(root, path.join(dir, entry.name), violations, readdir);
    }
  }
}

module.exports = { findNestedGitRepositories };
