'use strict';

// BL-1038: the "no unit-lane test's cost grows with the repository" check.
//
// Fixture builders copied every .bb in swarmforge/scripts/ - 208 files, 2.16MB,
// per build - so every new script made every fixture build slower forever, with
// no test added and no code changed. That is the growth term behind a surface
// that absorbed four measured budget raises in four days: each was correct when
// measured and stale within days. A budget cannot hold a number that rises on
// its own, so this removes the reason it moves rather than repricing it again.
//
// This guard stops NEW ones appearing. A file that genuinely must observe the
// live repository stays, behind an exemption that RECORDS WHY - and a bare
// marker fails, or this decays exactly as the budgets did (BL-999, one layer
// up).
const fs = require('fs');
const path = require('path');

// THE BOUNDARY, and it took four attempts to place - recorded so the next
// reader does not repeat them.
//
// Reaching the live tree is NOT the defect: reading one named file costs the
// same whatever the repo's size. The invariant is narrower and says so - no
// test's cost may be a function of the repository's SIZE or HISTORY DEPTH.
//
//   Flagging every repo-root resolution named ~30 files that read a single
//   literal in O(1); the real growth terms were lost among them.
//
//   Flagging "root bound and handed to production code" named 13; code given a
//   root may read one file or a thousand, and no static pattern separates them.
//
//   Flagging a growth op ANYWHERE in a file that mentions the root named four
//   *Bridge tests that `git init` their OWN temp repos - reporting BL-1039's
//   family as this ticket's violations, which it explicitly excludes.
//
// So the growth operation must TARGET the bound live root, by name. That is
// what separates "runs git log in a fixture it built" (BL-1039's, fine here)
// from "runs git log against this repository" (this ticket's).
const LIVE_ROOT_BINDING_RE = /(?:const|let)\s+(\w+)\s*=\s*path\.join\(\s*__dirname\s*,\s*'\.\.'\s*,\s*'\.\.'/;

function growthPatternsFor(rootName) {
  const R = rootName;
  return [
    {
      re: new RegExp(`git[^\\n]*\\b(?:log|rev-list|shortlog)\\b[^\\n]*${R}|${R}[^\\n]*git[^\\n]*\\b(?:log|rev-list|shortlog)\\b`),
      what: 'walks live git history (cost grows with history depth)',
    },
    { re: new RegExp(`readdirSync\\s*\\([^)]*${R}`), what: 'enumerates a live repository directory (cost grows with repo size)' },
    { re: new RegExp(`glob(?:Sync)?\\s*\\([^)]*${R}`), what: 'globs the live tree (cost grows with repo size)' },
  ];
}

// An exemption must RECORD A REASON. The relation is checked, not the marker's
// presence - present-but-unjustified is the state BL-999 found one layer down.
//
// [ \t]* deliberately, NOT \s*: \s crosses a newline, so a bare marker would
// capture the FIRST WORD OF THE NEXT LINE as its "reason" and every empty
// exemption would read as justified. That is the guard failing OPEN, which is
// the exact hazard this rule exists to close - and is what my first regex did.
const EXEMPTION_RE = /BL-1038-EXEMPT:[ \t]*(\S[^\n]*)/;

/** Pure: why this text derives from the live repository, or null. */
function liveRepoDerivation(text) {
  const bound = text.match(LIVE_ROOT_BINDING_RE);
  if (!bound) return null;
  for (const { re, what } of growthPatternsFor(bound[1])) {
    if (re.test(text)) return what;
  }
  return null;
}

/** Pure: the recorded reason, or null. A marker with no reason yields null. */
function exemptionReason(text) {
  const m = text.match(EXEMPTION_RE);
  if (!m) return null;
  const reason = m[1].trim();
  return reason.length > 0 ? reason : null;
}

/** Pure: the violation for one file, or null. */
function violationFor(relativePath, text) {
  const derivation = liveRepoDerivation(text);
  if (!derivation) return null;
  if (exemptionReason(text)) return null;
  return { file: relativePath, reason: derivation };
}

// This guard's own source, the pinned-fixture helper and this guard's test file
// NECESSARILY contain the patterns matched on. Excluded explicitly, or the
// guard goes red precisely because the code is correct (BL-1032, and the
// standing rule about self-referential guards).
const SELF_EXEMPT = [
  'helpers/liveRepoDerivationGuard.js',
  'helpers/pinnedRepoFixture.js',
  'liveRepoDerivationGuard.test.js',
];

function isSelfExempt(relativePath) {
  return SELF_EXEMPT.includes(relativePath);
}

/** Scan the unit lane. *.property.test.js is a separate lane with its own budget. */
function findLiveRepoDerivations(testDir) {
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

module.exports = {
  liveRepoDerivation,
  exemptionReason,
  violationFor,
  findLiveRepoDerivations,
  isSelfExempt,
  SELF_EXEMPT,
};
