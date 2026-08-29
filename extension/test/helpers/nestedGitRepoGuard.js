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
//   - a repository inside a directory this working tree's git IGNORES
//     (BL-1246, human ruling 2026-08-28 "Exempt git-ignored dirs (tmp/) by
//     construction"). `tmp/` is where workflow.prompt directs every role to
//     put scratch, so a role's git fixtures legitimately live there: nothing
//     tracked can be swallowed and no bookkeeping runs from there, which are
//     the two things that made backlog/.git a defect. Derived from git's own
//     ignore rules, never from a list of scratch paths - and asked about the
//     directory CONTAINING the nested `.git`, because git never considers a
//     `.git` path against ignore rules at all, so asking about
//     `tmp/evilmerge/.git` tells you nothing while `tmp/evilmerge` answers.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SKIP_DIR_NAMES = new Set(['node_modules', '.worktrees']);

/**
 * Does this working tree's git ignore `dir`? Fail-closed: only a clean exit 0
 * ("this path is ignored") exempts. Exit 1 is "not ignored"; anything else -
 * git missing, not a repository, a spawn failure - is not an answer, and an
 * unanswered question must never silence a leak.
 *
 * Asked lazily, once per candidate leak rather than once per directory
 * walked: the walk visits thousands of directories and finds a nested `.git`
 * essentially never, so this costs one spawn per report, not per node.
 */
function gitIgnoresDirectory(root, absoluteDir) {
  const relative = path.relative(root, absoluteDir);
  if (relative === '' || relative.startsWith('..')) {
    return false; // the working tree root itself is never "ignored"
  }
  const result = spawnSync('git', ['-C', root, 'check-ignore', '--quiet', '--', relative], {
    stdio: 'ignore',
  });
  return result.error === undefined && result.status === 0;
}

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
 * real filesystem. `isIgnored` is the same kind of seam for the BL-1246
 * ignore predicate, which otherwise needs a real repository behind it - a
 * synthetic tree cannot express an ignored directory without it.
 */
function findNestedGitRepositories(root, { readdir = fs.readdirSync, isIgnored } = {}) {
  const violations = [];
  const ignores = isIgnored ?? ((absoluteDir) => gitIgnoresDirectory(root, absoluteDir));
  walk(root, root, violations, readdir, ignores);
  return violations;
}

function walk(root, dir, violations, readdir, isIgnored) {
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
      if (entry.isDirectory() && !isIgnored(dir)) {
        // BL-1246: asked about `dir`, the directory CONTAINING this `.git`,
        // never about `full` - git does not answer for a `.git` path.
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
      walk(root, path.join(dir, entry.name), violations, readdir, isIgnored);
    }
  }
}

module.exports = { findNestedGitRepositories, gitIgnoresDirectory };
