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
//
// BL-1092: also recognise local helpers that SPAWN git under any name
// (runGit, g, …). Bare `git(` stays matched as the corpus convention; other
// wrappers are discovered from same-file definitions whose bodies spawn git.
const fs = require('fs');
const path = require('path');

// Inline / string spawn shapes, plus the corpus convention of a bare `git(`
// identifier call (still matched without a same-file definition - many files
// import the helper). Other wrapper names need a same-file definition that
// actually spawns git (see gitSpawningWrapperNames).
const INLINE_CREATES_A_REPO =
  /['"]git['"]\s*,\s*\[\s*['"]init['"]|['"]git\s+init\b|\binit\b[^\n]*--bare|\bgit\(\s*[^,()]+,\s*\[\s*['"]init['"]/;

const EXEMPTION_RE = /BL-1039-EXEMPT:[ \t]*(\S[^\n]*)/;

const SPAWN_GIT = /(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(\s*['"]git['"]/;

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

function sliceBalancedBlock(text, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openBraceIndex + 1, i);
    }
  }
  return text.slice(openBraceIndex + 1);
}

function gitSpawningWrapperNames(text) {
  const names = new Set();
  const defRe =
    /(?:function\s+(\w+)\s*\([^)]*\)\s*\{|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*(?:=>)?\s*\{)/g;
  let match;
  while ((match = defRe.exec(text)) !== null) {
    const name = match[1] || match[2];
    const openIdx = match.index + match[0].length - 1;
    const body = sliceBalancedBlock(text, openIdx);
    if (SPAWN_GIT.test(body)) names.add(name);
  }
  return names;
}

function wrapperInitCallRe(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\(\\s*[^,()]+,\\s*\\[\\s*['"]init['"]`);
}

function createsViaNamedWrapper(text) {
  for (const name of gitSpawningWrapperNames(text)) {
    if (name === 'git') continue; // already covered by INLINE_CREATES_A_REPO
    if (wrapperInitCallRe(name).test(text)) return true;
  }
  return false;
}

function createsRepository(text) {
  const cleaned = stripWholeLineStringLiterals(text);
  if (INLINE_CREATES_A_REPO.test(cleaned)) return true;
  return createsViaNamedWrapper(cleaned);
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
  return {
    file: relativePath,
    reason:
      'creates a git repository directly (`git init`) instead of taking one from the shared seeded fixture',
  };
}

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

module.exports = {
  createsRepository,
  exemptionReason,
  violationFor,
  findRepoCreations,
  isSelfExempt,
  SELF_EXEMPT,
  gitSpawningWrapperNames,
};
