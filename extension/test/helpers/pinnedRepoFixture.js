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

// The `.bb` files one script load-file's, as paths RELATIVE TO THE SCRIPT THAT
// NAMES THEM. A commented-out line is never an edge - several scripts carry a
// documentation comment showing the exact incantation a caller would use.
//
// BL-1240: this used to keep only the basename, mirroring
// master_checkout_drift_lib.bb's extract-load-file-basenames. That held while
// every closure lived flat in swarmforge/scripts/, and broke the moment one
// did not: unregistered_test_gate_lib.bb load-files
// `(fs/path (fs/parent ...) "test" "suite_inventory_lib.bb")`, the "test"
// segment was dropped, the copy looked for the file at the flat root, did not
// find it, and skipped it silently - so every fixture-built
// `bb swarm_handoff.bb` died on load with a FileNotFoundException.
//
// A load-file line builds its path from the referring file's directory plus
// the quoted segments that follow, so the segments before the `.bb` name are
// part of the path, not decoration. Everything up to the name is kept and
// normalised; `..` therefore means what it means in the script.
function loadFileDeps(source) {
  const deps = new Set();
  for (const line of source.split('\n')) {
    if (line.trim().startsWith(';')) continue;
    if (!line.includes('load-file')) continue;
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    quoted.forEach((value, i) => {
      // A quoted string ending in `.bb` that contains whitespace is prose
      // ("<x>.bb load-files <y>.bb"), not a filename.
      if (!value.endsWith('.bb') || /\s/.test(value)) return;
      // The path segments immediately preceding the name: the unbroken run of
      // quoted strings before it. A quoted string that is not a path segment
      // (a message, a flag) would have to sit directly against the filename
      // to be misread, and no load-file expression is written that way.
      const segments = [];
      for (let j = i - 1; j >= 0; j -= 1) {
        const seg = quoted[j];
        if (seg === '' || seg.endsWith('.bb') || seg.includes(' ')) break;
        segments.unshift(seg);
      }
      deps.add(path.posix.normalize([...segments, value].join('/')));
    });
  }
  return deps;
}

/**
 * Where `dep`, named inside `referrer`, actually lives - both relative to the
 * scripts directory root. A dependency that climbs out of that root cannot be
 * copied from it, so it keeps its normalised name and is skipped by the copy
 * exactly like any other name the reader cannot resolve.
 *
 * Two load-file idioms are in the tree and they look identical to a
 * segments-before-the-filename rule while meaning DIFFERENT anchors:
 *
 *   (fs/path (fs/parent *file*) "test" "x.bb")        relative to the referrer
 *   (fs/path repo-root "swarmforge" "scripts" "x.bb") the scripts root itself
 *
 * The second is anchored at the repository root, and `swarmforge/scripts` is
 * the very directory this walker is already based at - so those two segments
 * are the base, not a subdirectory under the referrer. Reading them as one
 * would yield `test/swarmforge/scripts/x.bb`, which exists nowhere, and the
 * copy would silently skip it: the exact failure this ticket exists to close,
 * one idiom over. The `(?:^|\/)` allows for a dep that climbs out with `..`
 * before naming the root.
 */
const SCRIPTS_ROOT_ANCHOR = /(?:^|\/)swarmforge\/scripts\/(.+)$/;

function resolveDepPath(referrer, dep, exists) {
  const anchored = SCRIPTS_ROOT_ANCHOR.exec(dep);
  if (anchored) return path.posix.normalize(anchored[1]);
  const dir = path.posix.dirname(referrer);
  const relative = path.posix.normalize(dir === '.' ? dep : `${dir}/${dep}`);
  if (dep.includes('/')) return relative;
  // A BARE name spells no path, so it names no anchor either: the expression
  // that built it started from a variable no quoted segment records
  // (`scripts-dir`, `(fs/parent (fs/parent *file*))`, `repo-root`). Both
  // readings are live in this tree - `test/suite_inventory_cli.bb` loads its
  // sibling `suite_inventory_lib.bb`, while `test/acp_session_lib_test_runner.bb`
  // loads the ROOT's `acp_session_lib.bb` - so the tree decides, nearest
  // first, exactly as the load-file expression itself would. With no reader
  // to ask, the historical flat reading stands.
  if (exists && exists(relative)) return relative;
  return dep;
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
    // Resolved against the naming file's own directory (BL-1240), so a script
    // inside test/ reaching back out with ".." names the root copy rather
    // than a second one under test/.
    if (source) {
      const exists = (candidate) => readSource(candidate) != null;
      for (const dep of loadFileDeps(source)) frontier.push(resolveDepPath(name, dep, exists));
    }
  }
  return seen;
}

/**
 * Copy exactly the closure of `entrypoints` from the live scripts directory
 * into `targetScriptsDir`. Returns the copied names.
 *
 * A missing name - entry point or dependency - throws rather than producing
 * a quietly incomplete fixture (BL-1294): a test that fails later, in an
 * unrelated file, for a missing script is far harder to read than one that
 * fails here naming it.
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
      const kind = entrypoints.includes(name) ? 'entry point' : 'dependency';
      throw new Error(`pinnedRepoFixture: ${kind} ${name} not found in ${liveScriptsDir}`);
    }
    const dest = path.join(targetScriptsDir, name);
    // A dependency that lives in a subdirectory is copied INTO one: the script
    // that loads it builds the path from its own location, so a flat copy is
    // a fixture the script cannot load (BL-1240).
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
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

module.exports = {
  loadFileDeps,
  resolveDepPath,
  resolveScriptClosure,
  copyScriptClosure,
  copyLiveScriptClosureInto,
};
