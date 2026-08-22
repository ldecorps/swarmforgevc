'use strict';

// BL-1038: build a fixture's swarmforge/scripts/ from a DEPENDENCY CLOSURE
// rather than by copying the whole live directory.
//
// The bridge/CLI fixtures copied every `.bb` in swarmforge/scripts/ - 208
// files, 2.16MB, per fixture build - so every new script in the repo made
// every one of those builds slower, forever, with no test added and no code
// changed. That is the growth term behind a surface that absorbed four
// measured budget raises in four days: each was correct when measured and
// stale within days.
//
// The closure of `commit_integrity_cli.bb` is 11 files. It grows only with
// that CLI's own dependencies - an unrelated new script anywhere in the repo
// does not change it - which is what makes the cost independent of the
// repository's size, per this ticket's first invariant.
//
// Derived, never hand-listed: a hand-maintained file list is the failure mode
// this codebase has hit repeatedly (it gets patched one name at a time and
// re-drifts). The closure is computed from the entry points the test actually
// invokes, so adding a dependency to a CLI is picked up automatically and
// REMOVING one shrinks the fixture.
const fs = require('fs');
const path = require('path');

// Mirrors master_checkout_drift_lib.bb's extract-load-file-basenames: the
// `.bb` files one script load-file's. A commented-out line is never an edge -
// several scripts carry a documentation comment showing the exact incantation
// a caller would use.
function loadFileDeps(source) {
  const deps = new Set();
  for (const line of source.split('\n')) {
    if (line.trim().startsWith(';')) continue;
    if (!line.includes('load-file')) continue;
    for (const m of line.matchAll(/"([^"]+\.bb)"/g)) {
      deps.add(path.basename(m[1]));
    }
  }
  return deps;
}

/**
 * Pure over an injected reader: the transitive load-file closure of
 * `entrypoints`, including the entrypoints themselves. A name the reader
 * cannot resolve is still included (so a missing dependency surfaces as a
 * copy failure naming it, never as a silently smaller fixture) but
 * contributes no further edges.
 */
function resolveScriptClosure(entrypoints, readSource) {
  const seen = new Set();
  const frontier = [...entrypoints];
  while (frontier.length > 0) {
    const name = frontier.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const source = readSource(name);
    if (source) for (const dep of loadFileDeps(source)) frontier.push(dep);
  }
  return seen;
}

/**
 * Copy exactly the closure of `entrypoints` from the live scripts directory
 * into `targetScriptsDir`. Returns the copied names.
 *
 * A missing entry point throws rather than producing a quietly incomplete
 * fixture: a test that fails later for a missing script is far harder to read
 * than one that fails here naming it.
 */
function copyScriptClosure(liveScriptsDir, targetScriptsDir, entrypoints) {
  const read = (name) => {
    const p = path.join(liveScriptsDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const closure = resolveScriptClosure(entrypoints, read);
  fs.mkdirSync(targetScriptsDir, { recursive: true });
  const copied = [];
  for (const name of [...closure].sort()) {
    const src = path.join(liveScriptsDir, name);
    if (!fs.existsSync(src)) {
      if (entrypoints.includes(name)) {
        throw new Error(`pinnedRepoFixture: entry point ${name} not found in ${liveScriptsDir}`);
      }
      continue;   // a dependency named but absent - the closure records it, the copy skips it
    }
    fs.copyFileSync(src, path.join(targetScriptsDir, name));
    copied.push(name);
  }
  return copied;
}

// The six bridge/CLI fixtures that used to copy the whole live
// swarmforge/scripts/ directory (BL-1038) all resolve the live scripts
// directory the same way, relative to THIS file rather than to each
// caller's own __dirname - one path expression instead of six copies of it.
function copyLiveScriptClosureInto(targetScriptsDir, entrypoints) {
  const liveScriptsDir = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
  return copyScriptClosure(liveScriptsDir, targetScriptsDir, entrypoints);
}

module.exports = { loadFileDeps, resolveScriptClosure, copyScriptClosure, copyLiveScriptClosureInto };
