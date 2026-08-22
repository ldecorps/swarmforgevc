'use strict';

// BL-1039: no unit-lane test creates a git repository of its own.
//
// Seventeen files ran `git init` and then built real commits, most once per
// scenario - four spawns before the behaviour under test was reached, ~165.9s
// of a 533.8s lane, and six of them among the nineteen breaching BL-378's
// per-file 7000ms budget. That gate runs on every `npm test` and its exit code
// folds into the run's, so the lane could not return green while this family
// existed - and a gate that is always red trains everyone to wave it through.
//
// SCOPE: repository CREATION only. This guard and BL-1038's classify
// OPERATIONS, not files, and six files do BOTH - they copy live sources into a
// fixture (BL-1038's to convert) AND run `git init` (this one's). A guard here
// that keyed on "reads a live path" would fire on BL-1038's work, and one
// written to own a file list would collide outright. Keying on the creation
// keeps the two guards disjoint by construction.
const fs = require('fs');
const path = require('path');

// `git init` however it is spawned: execFileSync('git', ['init'...]),
// spawnSync('git', ['init'...]), or a command string.
//
// D1 (architect SEND BACK #1) - THE SECOND ALTERNATION IS LOAD-BEARING, and
// leaving it out is what sent this parcel back. Every pattern above requires
// `git` to appear as a quoted STRING argument. The DOMINANT shape in this
// corpus is not that: it is a local wrapper function literally named `git`,
//
//     function git(cwd, args) { execFileSync('git', args, { cwd }); }
//     git(dir, ['init', '-q']);          // <- `git` is an identifier, not a string
//
// used by 43 files, of which the guard saw exactly zero - measured, and with
// zero overlap against its own violation list. The guard reported 16
// violations against a real 59.
//
// It keys on the CALL SITE rather than resolving the wrapper's binding. That
// is the same shortcut the inline case already takes, and it is the cheaper
// and more robust of the two: a file may import its wrapper or define it far
// from the call, and neither costs this pattern anything.
//
// `\bgit\(` deliberately requires the paren immediately after `git`, so
// `gitIn(dir, ['init'...])` - the shared fixture helper's OWN internal spawn,
// whose whole purpose is to create the template - is not matched by it. Widen
// this and the guard goes red precisely because the code is correct, which is
// the BL-1032 defect repeated one guard over.
const CREATES_A_REPO = /['"]git['"]\s*,\s*\[\s*['"]init['"]|['"]git\s+init\b|\binit\b[^\n]*--bare|\bgit\(\s*[^,()]+,\s*\[\s*['"]init['"]/;

// An exemption must RECORD A REASON - the relation is checked, not the
// marker's presence, the same rule BL-1038's guard applies one concern over.
// [ \t]* not \s*: \s crosses a newline and would capture the next line's first
// word as the "reason", so every bare marker would read as justified.
const EXEMPTION_RE = /BL-1039-EXEMPT:[ \t]*(\S[^\n]*)/;

// EXECUTING vs ASSERTING - the same distinction BL-1032 had to draw for the
// tmux guard, and the reason that ticket existed. A guard test builds fixture
// strings that CONTAIN a call:
//
//     "execFileSync('git', ['init', '-q'], { cwd: root });",
//
// That is test DATA describing a file's contents; it spawns nothing. A guard
// that cannot tell the two apart flags files for being correct, and its
// cheapest satisfying move is to obfuscate the string - which BL-1032 named as
// "a lie the next reader has to disbelieve".
//
// A line that is WHOLLY a string literal is data. Stripping those before
// scanning is a rule, not a hand-maintained exemption list - a list gets
// patched one filename at a time and re-drifts.
function stripWholeLineStringLiterals(text) {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim().replace(/,$/, '');
      const quoted = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
      return !(quoted && t.length > 2);
    })
    .join('\n');
}

function createsRepository(text) {
  return CREATES_A_REPO.test(stripWholeLineStringLiterals(text));
}

function exemptionReason(text) {
  const m = text.match(EXEMPTION_RE);
  if (!m) return null;
  const reason = m[1].trim();
  return reason.length > 0 ? reason : null;
}

function violationFor(relativePath, text) {
  if (!createsRepository(text)) return null;
  if (exemptionReason(text)) return null;
  return { file: relativePath, reason: 'creates a git repository directly (`git init`) instead of taking one from the shared seeded fixture' };
}

// The shared fixture helper creates a repository AS ITS WHOLE PURPOSE, and
// this guard's own source and test carry the needle as data. Excluded
// explicitly, or the guard goes red precisely because the code is correct.
const SELF_EXEMPT = [
  'helpers/sharedRepoFixture.js',
  'helpers/repoCreationGuard.js',
  'repoCreationGuard.test.js',
  'sharedRepoFixture.test.js',
];

function isSelfExempt(relativePath) {
  return SELF_EXEMPT.includes(relativePath);
}

function findRepoCreations(testDir) {
  const out = [];
  for (const entry of fs.readdirSync(testDir, { recursive: true })) {
    const rel = String(entry).split(path.sep).join('/');
    if (!rel.endsWith('.test.js') || rel.endsWith('.property.test.js')) continue;
    if (isSelfExempt(rel)) continue;
    const abs = path.join(testDir, rel);
    if (!fs.statSync(abs).isFile()) continue;
    const v = violationFor(rel, fs.readFileSync(abs, 'utf8'));
    if (v) out.push(v);
  }
  return out;
}

module.exports = { createsRepository, exemptionReason, violationFor, findRepoCreations, isSelfExempt, SELF_EXEMPT };
