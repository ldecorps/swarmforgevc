'use strict';

// BL-1343's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A land step never reports a ticket as landed, or as having
//                nothing left to replay, while the approved tip still differs
//                from origin/main on a path that ticket introduced.
//   invariant 2  A path the landing ticket's own tip introduces is excluded
//                from its replay only by a positive attribution to an
//                unlanded sibling, and never in silence - an exclusion that
//                would empty the ticket's contribution refuses and names the
//                path, the landing ticket and the sibling.
//
// Both drive the REAL swarmforge/scripts/land_step_lib.bb against real git
// fixtures - never a JavaScript restatement of the decision. Each generated
// repository is built and asked in one bb process, so a run costs one
// subprocess per case rather than one per question.
//
// GENERATOR REACH (the asserted floor, never a hoped-for one). The whole
// defect lives in ONE corner: a path the landing ticket introduces whose only
// attributing commit names a sibling. A generator drawing subjects freely
// would reach that corner rarely and pass while the defect was live - the
// "technically reachable but astronomically rare" shape. So the subject of
// each commit is derived FROM the path it introduces, by the very
// misattribution the code conflates.
//
// And the corner is reached BY CONSTRUCTION, not by draw. Each of the three
// shapes - every path credited to a sibling, a genuinely mixed set, none
// credited to a sibling - gets its own property run; only the file set inside
// a shape is generated. The earlier version drew each file's credit
// independently, which left the all-sibling corner at P ~= 0.12 per case, so
// its own coverage floor red the suite about one run in six (architect bounce
// D1, 2026-09-02). A floor that bites for no reason is the mirror image of a
// vacuous one, and on land machinery an intermittent red is how a real
// regression gets waved through as "just the flaky one". The floors below now
// hold because every shape ran, not because a draw was lucky.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1343-property-';
const TICKET = 'BL-9343';
const SIBLING = 'BL-9344';

// BL-971: a killed run traps nothing, so sweep by prefix BEFORE the run too.
function sweepStaleFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function buildRepo(files) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  git(root, 'update-ref', 'refs/remotes/origin/main', execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());

  for (const file of files) {
    const full = path.join(root, file.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${file.path}\n`);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', file.subject);
  }
  return root;
}

function ask(root, expression) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string ${expression}))`;
  const result = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(result.status, 0, `bb failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function headOf(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function ownPaths(root) {
  return ask(root, `(land-step-lib/own-paths "${root}" "${headOf(root)}" "${TICKET}" #{"${SIBLING}"})`);
}

function landPlan(root) {
  return ask(root, `(land-step-lib/land-plan {:root "${root}" :commit "${headOf(root)}" :task-ticket-id "${TICKET}"})`);
}

// Every generated file is one the landing ticket's tip introduces (absent
// from origin/main by construction, since origin/main is the seed). What
// varies is who the subject credits it to - and a "sibling" credit is
// derived from the file itself rather than drawn independently, so every
// case is a misattribution candidate by construction.
//
// D1 (architect bounce, 2026-09-02): the credits used to be drawn
// independently per file, uniformly over three values. Reaching the corner
// that matters - EVERY path credited to a sibling - then depended on an
// unlucky-free draw: P ~= 0.12 per case, so P(a 25-run pass never reaches it)
// ~= 4.6% per test, and the coverage floor itself red the suite about one run
// in six. A floor assertion that bites for no reason is the mirror image of a
// vacuous one, and on land machinery an intermittent red is how a real
// regression gets waved through.
//
// So the SHAPE is now drawn, not the credits: the generator picks which of
// the three shapes a case has, and then constructs credits to match. Every
// shape is reachable in one draw, and the floors below are satisfied by
// construction rather than by luck.
const SHAPES = ['all-sibling', 'mixed', 'none-sibling'];

// The shape is not drawn at all - each shape gets its OWN property run, so
// "did the run reach this corner" stops being a question about luck. Only the
// file set inside a shape is generated.
const caseArbFor = (shape) =>
  fc.record({
    shape: fc.constant(shape),
    files: fc.array(
    fc.record({
      name: fc.constantFrom('handler.js', 'lib.bb', 'doc.md', 'ticket.yaml', 'runner.sh'),
      dir: fc.constantFrom('specs/pipeline/steps', 'swarmforge/scripts', 'docs', 'backlog/active'),
      untaggedWhenFree: fc.boolean(),
    }),
      { minLength: 1, maxLength: 4 },
    ),
  });

// The shape decides each file's credit. 'mixed' is forced to be genuinely
// mixed - at least one sibling AND at least one survivor - which an
// independent draw could not guarantee either.
function creditsFor(shape, count, freeFlags) {
  if (shape === 'all-sibling') return Array.from({ length: count }, () => 'sibling');
  if (shape === 'none-sibling') {
    return freeFlags.map((untagged) => (untagged ? 'nobody' : 'own'));
  }
  if (count === 1) return ['sibling'];
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return 'sibling';
    if (i === 1) return freeFlags[1] ? 'nobody' : 'own';
    return freeFlags[i] ? 'sibling' : 'own';
  });
}

function toCommits(testCase) {
  const { shape, files } = testCase;
  const credits = creditsFor(shape, files.length, files.map((f) => f.untaggedWhenFree));
  // Distinct paths only: two commits on the same path would make "who
  // introduced it" a different question than the one under test.
  const seen = new Set();
  const out = [];
  for (const [i, f] of files.entries()) {
    const p = `${f.dir}/${i}-${f.name}`;
    if (seen.has(p)) continue;
    seen.add(p);
    const creditedTo = credits[i];
    const subject =
      creditedTo === 'sibling'
        ? `${SIBLING}: sibling commit carrying ${p}`
        : creditedTo === 'own'
          ? `${TICKET}: own work on ${p}`
          : `housekeeping touching ${p}`;
    out.push({ path: p, subject, creditedTo });
  }
  return out;
}

test('BL-1343/BL-654 invariant 1: a differing tip is never reported as landed or as nothing left to replay', () => {
  sweepStaleFixtures();
  const reach = { fullySubtracted: 0, partiallySubtracted: 0, nothingSubtracted: 0 };

  for (const shape of SHAPES) {
    fc.assert(
      fc.property(caseArbFor(shape), (testCase) => {
        const commits = toCommits(testCase);
        const root = buildRepo(commits);
        try {
          const survivors = commits.filter((c) => c.creditedTo !== 'sibling');
          if (survivors.length === 0) reach.fullySubtracted += 1;
          else if (survivors.length < commits.length) reach.partiallySubtracted += 1;
          else reach.nothingSubtracted += 1;

          const plan = landPlan(root);

          // :land means "merge this tip as it stands", which carries every one
          // of the ticket's paths onto main - a real completion, admissible
          // only when no sibling is entangled and so nothing was subtracted.
          // With a sibling in the range, the tip cannot be taken whole, and
          // calling it landed is exactly the silent loss this invariant bans.
          if (plan.action === 'land') {
            assert.equal(
              commits.filter((c) => c.creditedTo === 'sibling').length,
              0,
              `reported LAND on a tip whose paths a sibling would subtract: ${JSON.stringify(plan)}`,
            );
            return true;
          }
          if (plan.action === 'replay') {
            assert.ok(
              Array.isArray(plan['own-paths']) && plan['own-paths'].length > 0,
              `replay with nothing to replay, on a tip that still differs: ${JSON.stringify(plan)}`,
            );
          } else {
            assert.equal(plan.action, 'escalate', `unexpected action: ${JSON.stringify(plan)}`);
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 9 },
    );
  }

  assert.ok(reach.fullySubtracted > 0, 'generator never reached a fully-subtracted contribution - the defect corner went untested');
  assert.ok(reach.partiallySubtracted > 0, 'generator never reached a partial subtraction');
  assert.ok(reach.nothingSubtracted > 0, 'generator never reached a case where nothing is subtracted');
});

test('BL-1343/BL-654 invariant 2: an exclusion that empties the contribution refuses, naming path, ticket and sibling', () => {
  sweepStaleFixtures();
  const reach = { refusals: 0, kept: 0 };

  for (const shape of SHAPES) {
    fc.assert(
      fc.property(caseArbFor(shape), (testCase) => {
        const commits = toCommits(testCase);
        const root = buildRepo(commits);
        try {
          const result = ownPaths(root);
          const siblingOnly = commits.filter((c) => c.creditedTo === 'sibling');
          const survivors = commits.filter((c) => c.creditedTo !== 'sibling');

          if (survivors.length === 0) {
            // Every path credited away: a refusal, and one that says what it
            // removed - never a silent empty set.
            reach.refusals += 1;
            assert.equal(result.paths, null, `a fully-subtracted contribution answered silently: ${JSON.stringify(result)}`);
            const text = result.warning || '';
            assert.ok(text.includes(TICKET), `the refusal does not name the landing ticket: ${text}`);
            assert.ok(text.includes(SIBLING), `the refusal does not name the sibling: ${text}`);
            for (const c of siblingOnly) {
              assert.ok(text.includes(c.path), `the refusal does not name ${c.path}: ${text}`);
            }
          } else {
            // Something of the ticket's own survives, so the subtraction is
            // ordinary tip-pure replay and must NOT refuse (BL-1241/BL-1272
            // untouched).
            reach.kept += 1;
            assert.ok(Array.isArray(result.paths), `an ordinary replay refused: ${JSON.stringify(result)}`);
            assert.equal(result.warning, null);
            for (const c of survivors) {
              assert.ok(result.paths.includes(c.path), `${c.path} was dropped from the replay set`);
            }
            for (const c of siblingOnly) {
              assert.ok(!result.paths.includes(c.path), `${c.path} is a sibling's and should not be replayed`);
            }
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 9 },
    );
  }

  assert.ok(reach.refusals > 0, 'generator never emptied the contribution - the refusal branch never fired');
  assert.ok(reach.kept > 0, 'generator never kept a path - the non-refusal branch never fired');
});
