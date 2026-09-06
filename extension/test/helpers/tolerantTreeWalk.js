'use strict';

// BL-1443: the ONE shared tree walk every property test uses to read a live
// (non-mkdtemp) tree - bl874's ENOENT on a bl868 fixture (QA's full run,
// 2026-09-06) was one test's inline walk losing a race against another
// test's transient fixture file, removed between the walk listing its
// directory and reading that file. Declared invariants:
//
//   1. A file that vanishes between a directory listing and its read is
//      skipped by every property-lane tree walk; no other read or listing
//      error is swallowed by that tolerance.
//   2. The helper reads only: it never writes, moves or deletes a path and
//      never sweeps by prefix (BL-1385/BL-1390).
//
// Only the CONTENT READ (readFileSync) is tolerant of ENOENT. A directory
// listing (readdirSync) - the root's own, or one reached by recursing into
// a subdirectory - is never wrapped: if a subdirectory vanishes between
// being listed and being recursed into, that is a listing error and it
// throws, naming the path, same as any other unexpected failure.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'out', 'coverage', '.stryker-tmp', 'vendor', '.worktrees']);

// walkFilesTolerant(root, opts) -> string[] of file paths, or
// {path, content}[] when opts.withContent is true.
//
// opts:
//   excludeDirs  Set<string> of directory basenames never recursed into.
//                Default DEFAULT_EXCLUDED_DIR_NAMES (bl874's own set).
//   extension    Only files whose name ends with this string are yielded.
//                Default: every file.
//   withContent  When true, each result is {path, content}: the file is
//                read through fsImpl, and a read that fails with ENOENT
//                (the file listed, then removed before being read) is
//                skipped rather than thrown - the whole of invariant 1.
//                Any other read failure (EACCES, EISDIR, ...) throws,
//                naming the path.
//   encoding     Passed to fsImpl.readFileSync when withContent is true.
//                Default 'utf8'.
//   fsImpl       fs-shaped object - the seam a caller uses to make a read
//                fail with a chosen code without chmod (engineering rule:
//                never chmod for failure simulation). Default the real
//                `fs` module.
function walkFilesTolerant(root, opts = {}) {
  const {
    excludeDirs = DEFAULT_EXCLUDED_DIR_NAMES,
    extension = null,
    withContent = false,
    encoding = 'utf8',
    fsImpl = fs,
  } = opts;

  const results = [];

  function walk(dir) {
    const entries = fsImpl.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) {
          walk(full);
        }
        continue;
      }
      if (extension && !entry.name.endsWith(extension)) {
        continue;
      }
      if (!withContent) {
        results.push(full);
        continue;
      }
      let content;
      try {
        content = fsImpl.readFileSync(full, encoding);
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          continue; // vanished between listing and read - not an error
        }
        throw err;
      }
      results.push({ path: full, content });
    }
  }

  walk(root);
  return results;
}

module.exports = { walkFilesTolerant, DEFAULT_EXCLUDED_DIR_NAMES };
