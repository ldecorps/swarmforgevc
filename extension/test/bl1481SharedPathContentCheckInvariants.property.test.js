'use strict';

// BL-1481's three DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The land step never replays a path whose tip-versus-
//                origin/main diff carries a line attributable to a
//                blocking sibling (bounced, withheld, awaiting approval, or
//                unreadable) - added or removed - so no blocking sibling's
//                content reaches main through another ticket's land.
//   invariant 2  A shared path whose every changed line versus origin/main
//                is attributable to the lander is never refused on account
//                of that sibling, whatever the commit history says about
//                who touched the path.
//   invariant 3  The content check fails closed: a changed line whose
//                attribution cannot be read refuses the path, naming it -
//                never a silent pass.
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb against real git
// fixtures - never a JavaScript restatement of the decision.
//
// GENERATOR REACH (reached by construction, never by draw). The defect
// lives in ONE shape: a path both the landing ticket and a BLOCKING
// unlanded sibling (bounced) touched, where the tip's content versus
// origin/main may or may not still carry one of the sibling's own lines.
// Each content shape gets its OWN property pass - still-blocking (added),
// still-blocking (removed), content-clear - so every corner is exercised
// in every run and the floors below hold because the shapes ran, not
// because a draw was lucky.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1481-property-';
const LANDING = 'BL-9481';
const SIBLING = 'BL-9482';
const OTHER_PATH = 'other.txt';

const SHAPES = ['still-blocking-added', 'still-blocking-removed', 'content-clear'];

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function head(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function writeTicket(root, id, extraYaml) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\nstatus: todo\n${extraYaml || ''}`);
}

function writeBounce(root, ticket, commit, at) {
  const dir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, '2026-09.jsonl'),
    JSON.stringify({ ticket, producingRole: 'coder', ticketType: 'defect', failureClass: 'behavior', commit, by: 'QA', at }) + '\n',
  );
}

// Every shape produces a path BOTH the lander and the bounced sibling
// commit-attribution-own, with a DIFFERENT content relationship to
// origin/main.
function buildFixture(shape, rel) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeTicket(root, SIBLING, 'human_approval: approved\n');

  let bounceCommit;
  switch (shape) {
    case 'still-blocking-added':
      commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
      markOriginMain(root);
      commitFile(root, rel, 'base\n', `${LANDING}: lander seeds ${rel}`);
      commitFile(root, rel, 'base\nsibling line\n', `${SIBLING}: sibling adds a line only it owns`);
      bounceCommit = head(root);
      break;
    case 'still-blocking-removed':
      commitFile(root, rel, 'base\nsibling line\n', `${SIBLING}: sibling adds its line`);
      markOriginMain(root);
      commitFile(root, rel, 'base\n', `${SIBLING}: sibling deletes its own line`);
      bounceCommit = head(root);
      commitFile(root, rel, 'base\nlander line\n', `${LANDING}: the lander adds its own line`);
      break;
    case 'content-clear':
      commitFile(root, rel, 'base\n', 'seed the shared file');
      markOriginMain(root);
      commitFile(root, rel, 'base\nsibling line\n', `${SIBLING}: sibling adds its line`);
      bounceCommit = head(root);
      // Touches a SECOND path that never lands, so the sibling stays
      // genuinely unlanded overall (BL-1389's own ticket-level split) -
      // the point under test is ONE shared path whose content clears.
      commitFile(root, OTHER_PATH, 'never landed\n', `${SIBLING}: touches an unrelated path that never lands`);
      git(root, 'checkout', '-q', '-b', 'replay-landed', execFileSync(
        'git', ['rev-parse', 'refs/remotes/origin/main'], { cwd: root, encoding: 'utf8' },
      ).trim());
      commitFile(root, rel, 'base\nsibling line\n', `${SIBLING}: replayed tip-pure`);
      markOriginMain(root);
      git(root, 'checkout', '-q', 'main');
      commitFile(root, rel, 'base\nsibling line\nlander line\n', `${LANDING}: the lander adds its own line`);
      break;
    default:
      throw new Error(`unknown shape: ${shape}`);
  }
  writeBounce(root, SIBLING, bounceCommit, '2026-09-07T11:48:00.000Z');
  return root;
}

function ownPaths(root, forceUnreadable) {
  const optsExpr = forceUnreadable ? '{:content-blocked-fn (fn [_ _] nil)}' : '{}';
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  (land-step-lib/own-paths "${root}" "${head(root)}" "${LANDING}" #{"${SIBLING}"} nil nil ${optsExpr})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const relArb = fc.constantFrom(
  'shared.txt',
  'docs/reference/notes.md',
  'specs/pipeline/steps/shared-thing.js',
);

test('BL-1481/BL-654 invariant 1: never replays a path carrying a line attributable to a still-blocking sibling', () => {
  const reach = { 'still-blocking-added': 0, 'still-blocking-removed': 0 };

  for (const shape of ['still-blocking-added', 'still-blocking-removed']) {
    fc.assert(
      fc.property(relArb, (rel) => {
        const root = buildFixture(shape, rel);
        try {
          reach[shape] += 1;
          const result = ownPaths(root, false);
          assert.equal(result.paths, null, `expected a refusal for shape ${shape}, got: ${JSON.stringify(result)}`);
          assert.ok(result.warning.includes(rel), `refusal does not name the path (shape ${shape}): ${result.warning}`);
          assert.ok(result.warning.includes(SIBLING), `refusal does not name the sibling (shape ${shape}): ${result.warning}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  for (const shape of Object.keys(reach)) {
    assert.ok(reach[shape] > 0, `never exercised the ${shape} shape`);
  }
});

test('BL-1481/BL-654 invariant 2: a shared path clears when every changed line is the lander\'s own', () => {
  let reach = 0;

  fc.assert(
    fc.property(relArb, (rel) => {
      const root = buildFixture('content-clear', rel);
      try {
        reach += 1;
        const result = ownPaths(root, false);
        assert.ok(Array.isArray(result.paths), `content-clear shape refused: ${JSON.stringify(result)}`);
        assert.ok(result.paths.includes(rel), `${rel} should still replay once content clears: ${JSON.stringify(result)}`);
        assert.equal(result.warning, null, `content-clear shape should not warn: ${JSON.stringify(result)}`);
        assert.deepEqual(
          result['content-clear'],
          [{ path: rel, sibling: SIBLING }],
          `the report should name the sibling as content-clear for the path: ${JSON.stringify(result)}`,
        );
        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 3 },
  );

  assert.ok(reach > 0, 'never exercised the content-clear shape - the fix corner went untested');
});

test('BL-1481/BL-654 invariant 3: an unreadable content attribution fails closed, never a silent pass, in EVERY shape', () => {
  const reach = Object.fromEntries(SHAPES.map((s) => [s, 0]));

  for (const shape of SHAPES) {
    fc.assert(
      fc.property(relArb, (rel) => {
        const root = buildFixture(shape, rel);
        try {
          reach[shape] += 1;
          const result = ownPaths(root, true);
          // Whatever the shape - even content-clear, which would otherwise
          // replay - an unreadable content check must refuse, never widen
          // into a pass on an incomplete read.
          assert.equal(result.paths, null, `an unreadable content check did not refuse (shape ${shape}): ${JSON.stringify(result)}`);
          assert.ok(result.warning.includes(rel), `refusal does not name the path (shape ${shape}): ${result.warning}`);
          assert.ok(
            result.warning.toLowerCase().includes('unreadable'),
            `refusal does not name the unreadable attribution (shape ${shape}): ${result.warning}`,
          );
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  for (const shape of SHAPES) {
    assert.ok(reach[shape] > 0, `never exercised the ${shape} shape`);
  }
});
