'use strict';

const { execFileSync } = require('node:child_process');

// BL-1462: a linked role worktree is discovered from the live
// `git worktree list`, never assumed to be whichever checkout the calling
// process happens to sit in (BL-968 scenario 04's original defect) - same
// fix pattern as ticketYamlLookup.js: locate, don't assume.
function listWorktrees(cwd) {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  const entries = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length) };
    } else if (current && line === 'bare') {
      current.bare = true;
    } else if (current && line === 'detached') {
      current.detached = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

// `git worktree list`'s own contract: the FIRST entry is always the
// main/master checkout - never inferred from .git being a directory there,
// which is merely a symptom of it, not the definition.
function masterCheckoutPath(cwd) {
  const entries = listWorktrees(cwd);
  return entries.length ? entries[0].path : null;
}

// The first LINKED worktree (i.e. not the master checkout), or null when
// none exists - a real missing precondition, never a false assumption about
// whichever checkout this process happens to run in.
function firstLinkedWorktreePath(cwd) {
  const entries = listWorktrees(cwd);
  if (entries.length < 2) return null;
  const master = entries[0].path;
  const linked = entries.slice(1).find((entry) => !entry.bare && entry.path !== master);
  return linked ? linked.path : null;
}

module.exports = { listWorktrees, masterCheckoutPath, firstLinkedWorktreePath };
