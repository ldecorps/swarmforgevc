'use strict';

// BL-944: derives the REAL transitive load-file closure of
// operator_runtime.bb from source, so a fixture-file-list drift fails one
// named test instead of thirteen unrelated scenarios all failing at once
// with a FileNotFoundException naming a file no scenario mentions - the
// repeat failure mode (BL-412/413/458/647/655/944, six occurrences of one
// pattern) OPERATOR_RUNTIME_BB_FILES's own header comments already
// name-checked without ever becoming a gate (BL-897: "a 'kept in sync'
// comment is not a gate - drift fails silently").
//
// Every load-file form in this codebase resolves relative to the LOADING
// file's own directory via the identical idiom:
//   (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "NAME.bb")))
// Every .bb file involved here lives flat under swarmforge/scripts/ (never
// a subdirectory), so "relative to the loading file's directory" is always
// the same directory - the closure walk needs no path resolution beyond
// that one root.
const fs = require('node:fs');
const path = require('node:path');

const LOAD_FILE_RE = /\(load-file\b[\s\S]*?"([^"]+\.bb)"/g;

// Pure: given one file's raw source, returns the .bb filenames it
// load-files directly (no recursion, no fs).
function directLoadFileDeps(sourceText) {
  const deps = [];
  let match;
  LOAD_FILE_RE.lastIndex = 0;
  while ((match = LOAD_FILE_RE.exec(sourceText))) {
    deps.push(match[1]);
  }
  return deps;
}

// Impure: walks the transitive load-file closure of entryFile (a bare
// filename, e.g. "operator_runtime.bb") within scriptsDir - every .bb file
// it load-files, and everything THEY load-file, recursively. Returns the
// closure as a Set INCLUDING the entry file itself (matching
// OPERATOR_RUNTIME_BB_FILES's own existing convention: operator_runtime.bb
// is listed alongside its dependencies, not implied). A dependency that
// does not exist on disk is included in the returned set regardless (so a
// caller can report it as a real gap) but is not itself walked further.
function computeClosure(scriptsDir, entryFile) {
  const closure = new Set([entryFile]);
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.shift();
    const fullPath = path.join(scriptsDir, file);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    const text = fs.readFileSync(fullPath, 'utf8');
    for (const dep of directLoadFileDeps(text)) {
      if (!closure.has(dep)) {
        closure.add(dep);
        queue.push(dep);
      }
    }
  }
  return closure;
}

// Pure-ish (one fs walk, no recursion beyond computeClosure's own):
// compares the REAL closure against a maintained list, returning
// { missing: [...], extra: [...] } - missing: closure members absent from
// the list (invariant 1's violation shape); extra: UNDECLARED list members
// the closure never reaches (the operator_ask.bb-shaped hygiene concern,
// scenario 03) - a name present in declaredExtras is a deliberate,
// documented exception and never reported. Both sorted for stable,
// readable test output.
function diffClosureAgainstList(scriptsDir, entryFile, maintainedList, declaredExtras) {
  const closure = computeClosure(scriptsDir, entryFile);
  const listed = new Set(maintainedList);
  const declared = new Set((declaredExtras || []).map((e) => (typeof e === 'string' ? e : e.file)));
  const missing = [...closure].filter((f) => !listed.has(f)).sort();
  const extra = [...listed].filter((f) => !closure.has(f) && !declared.has(f)).sort();
  return { missing, extra, closure };
}

module.exports = { directLoadFileDeps, computeClosure, diffClosureAgainstList };
