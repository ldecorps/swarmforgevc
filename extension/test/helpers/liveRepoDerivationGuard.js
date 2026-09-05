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
// BL-1435: a SECOND idiom binds the same live root - `git rev-parse
// --show-toplevel` run against `__dirname` (via execFileSync/execSync/
// spawnSync, with or without an explicit `-C __dirname` arg or a `{ cwd:
// __dirname }` option). __dirname is the load-bearing tell, exactly as it
// is for the path.join idiom below: a rev-parse against any OTHER root
// (a mkTmpDir fixture, `git init`'d separately) resolves THAT fixture's
// own top level, never the live repository, and must never match here -
// that is BL-1039's own fixture-git exemption class, untouched by this
// widening. One alternation, matched by the SAME regex the path.join form
// uses, so the two idioms can never diverge in which rules apply to them
// (invariant 1).
// The three tells (`__dirname`, `rev-parse`, `--show-toplevel`) are looked
// for in the window up to the call's own closing paren, never anchored to
// the args array alone - `__dirname` may sit inside it (`-C`, __dirname])
// or in a trailing `{ cwd: __dirname }` options object instead, and both
// shapes occur in the real files this ticket names.
const REV_PARSE_TOPLEVEL_SRC = String.raw`(?:execFileSync|execSync|spawnSync)\s*\(\s*['"]git['"]\s*,\s*(?=[^)]*__dirname)(?=[^)]*\brev-parse\b)(?=[^)]*--show-toplevel)\[[^\]]*\](?:\s*,\s*\{[^}]*\})?`;
const LIVE_ROOT_BINDING_RE = new RegExp(
  String.raw`(?:const|let)\s+(\w+)\s*=\s*(?:path\.join\(\s*__dirname\s*,\s*'\.\.'\s*,\s*'\.\.'|${REV_PARSE_TOPLEVEL_SRC})`
);

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
// ── D1: the live root ESCAPING into production code ───────────────────────
//
// Architect SEND BACK #1 and #2, same defect both times. The four files this
// ticket was minted to fix - renderBriefingDiagramsCli, renderBriefingBurndownCli,
// briefingDigestLineCli, emitLifecycleSnapshotCli, ~99.9s of the measured
// profile - never write a growth operation in their own source. They hand the
// bound root to a production module and let IT do the reading, so every
// pattern above missed them, `findLiveRepoDerivations` returned `[]`, and the
// "real tree is clean" assertion passed vacuously against the majority of the
// cost this guard exists to hold.
//
// THE BOUNDARY MOVES, deliberately, and the note above records why it sat
// where it did: "code given a root may read one file or a thousand, and no
// static pattern separates them." That was true and is still true - which is
// precisely why it cannot be settled by a cleverer pattern. Handing the LIVE
// root to production code IS the derivation, because the test stops
// controlling what gets read; whether a given escape is acceptable is settled
// by a RECORDED EXEMPTION, not by the scanner guessing.
//
// Text-only, no module resolution: what makes a callee "production" is that
// the file imports it from ../out/ or ../src/, which the source says outright.
const PROD_REQUIRE = /require\(\s*['"](\.\.[^'"]*\/(?:out|src)\/[^'"]*)['"]\s*\)/;
// BL-1435: same widening as LIVE_ROOT_BINDING_RE above, for the inline
// (never-named) form - one source string, reused everywhere a "live root
// written straight into a call" is matched, so the two idioms cannot
// diverge here either (invariant 1).
const LIVE_ROOT_INLINE_SRC = String.raw`(?:path\.join\(\s*__dirname\s*,\s*'\.\.'\s*,\s*'\.\.'\s*\)|${REV_PARSE_TOPLEVEL_SRC})`;

// Identifiers bound to a production module: both `const { a, b } = require(...)`
// and `const m = require(...)`.
function productionImportNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!PROD_REQUIRE.test(`require('${m[2]}')`)) continue;
    for (const raw of m[1].split(',')) {
      const n = raw.split(':').pop().trim();
      if (n) names.add(n);
    }
  }
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (PROD_REQUIRE.test(`require('${m[2]}')`)) names.add(m[1]);
  }
  return names;
}

// A local function is production-reaching when its body calls one (one level
// of indirection, closed to a fixpoint) or spawns something under out/.
// runCli()/runCliSubprocess() are exactly this shape, and matching only the
// direct call is why two of the four files stayed invisible.
function productionReachingCallees(text) {
  const reaching = productionImportNames(text);
  // Both body shapes, because both occur: a multi-line body closing on its own
  // line, and a one-liner like `async function runCli(root) { return main(root); }`.
  // Matching only the first is why the local-wrapper case stayed invisible.
  const bodies = [];
  const decls = [
    /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g,
    /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{([^\n]*)\}/g,
    /(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\}/g,
    /(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{([^\n]*)\}/g,
  ];
  for (const re of decls) {
    for (const m of text.matchAll(re)) bodies.push({ name: m[1], body: m[2] });
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const { name, body } of bodies) {
      if (reaching.has(name)) continue;
      const spawnsBuild = /(?:execFileSync|execSync|spawnSync|spawn|fork)\s*\([\s\S]*?['"][^'"]*\bout\b/.test(body) ||
        /\bout['"]\s*,\s*['"]tools['"]/.test(body);
      const callsProd = [...reaching].some((p) => new RegExp(String.raw`\b${p}\s*\(`).test(body));
      if (spawnsBuild || callsProd) {
        reaching.add(name);
        grew = true;
      }
    }
  }
  return reaching;
}

// The live root as this file names it: every `x = path.join(__dirname,'..','..')`
// binding, plus the inline expression written straight into a call.
function liveRootArgumentPatterns(text) {
  const alts = [LIVE_ROOT_INLINE_SRC];
  for (const m of text.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*${LIVE_ROOT_INLINE_SRC}`, 'g'))) {
    alts.push(String.raw`\b${m[1]}\b`);
  }
  return alts;
}

function liveRootEscapesIntoProduction(text) {
  const callees = productionReachingCallees(text);
  if (callees.size === 0) return null;
  const roots = liveRootArgumentPatterns(text).join('|');
  for (const callee of callees) {
    // The root as ANY argument of the call, not only the first.
    const re = new RegExp(String.raw`\b${callee}\s*\(\s*(?:[^()]*?,\s*)?(?:${roots})`);
    if (re.test(text)) {
      return `hands the live repository root to production code (${callee}), whose cost is whatever that code reads`;
    }
  }
  return null;
}

function liveRepoDerivation(text) {
  const bound = text.match(LIVE_ROOT_BINDING_RE);
  if (bound) {
    for (const { re, what } of growthPatternsFor(bound[1])) {
      if (re.test(text)) return what;
    }
  }
  // The indirect case runs even with no binding at all: an inline
  // `path.join(__dirname,'..','..')` written straight into the call is how
  // briefingDigestLineCli reaches the live repo.
  return liveRootEscapesIntoProduction(text);
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
