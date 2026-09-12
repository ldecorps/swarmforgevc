'use strict';

// BL-1546's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A path is never silently excluded from a replay on the
//                strength of owners that are all closed on origin/main: it
//                is kept for the landing ticket, or the land refuses
//                naming the commit, the closed owner and the path.
//   invariant 2  Closed is a positive finding - the owner's ticket file
//                read under backlog/done/ on origin/main; an owner whose
//                folder cannot be read is not closed and the pre-existing
//                exclusion rule applies unchanged.
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb against real git
// fixtures - never a JavaScript restatement of the decision.
//
// GENERATOR REACH (reached by construction, never by draw). Invariant 1
// needs both of its outcomes exercised in every run: a closed-owner path
// the lander also touches (kept, passenger) and one it does not (refused
// by name) - each its own shape, not a coin flip. Invariant 2 needs every
// "not a positive done reading" shape exercised: no ticket file at all,
// filed under an open folder (active), and filed under BOTH done and
// active at once (ambiguous) - each must still fall through to the
// pre-existing BL-1389 silent-exclusion rule, unchanged by this ticket.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1546-property-';
const LANDING = 'BL-9646';
const SIBLING = 'BL-9647';

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

function writeDoneTicket(root, id) {
  commitFile(root, `backlog/done/M8/${id}-fixture.yaml`, `id: ${id}\nstatus: done\nhuman_approval: approved\n`, `${id}: done ticket fixture file`);
}

function writeActiveTicket(root, id) {
  commitFile(root, `backlog/active/${id}-fixture.yaml`, `id: ${id}\nhuman_approval: approved\n`, `${id}: active ticket fixture file`);
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
}

// invariant 1's two shapes: a closed-owner path, with or without the
// lander's own touch.
function buildClosedFixture(shape, rel) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  initRepo(root);
  commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
  writeDoneTicket(root, SIBLING);
  markOriginMain(root);
  commitFile(root, rel, 'v1\n', `Update ${rel} for ${SIBLING}'s chokepoint fold`);
  if (shape === 'own-touch') {
    commitFile(root, rel, 'v2\n', `${LANDING}: own touch on ${rel}`);
  }
  commitFile(root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own bookkeeping`);
  return root;
}

// invariant 2's three "not a positive done reading" shapes.
function buildNotClosedFixture(shape, rel) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  initRepo(root);
  commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
  if (shape === 'active-only') {
    writeActiveTicket(root, SIBLING);
  } else if (shape === 'both-folders') {
    writeDoneTicket(root, SIBLING);
    writeActiveTicket(root, SIBLING);
  }
  // 'no-file-at-all': neither folder gets a ticket file for SIBLING.
  markOriginMain(root);
  commitFile(root, rel, 'v1\n', `Update ${rel} for ${SIBLING}'s chokepoint fold`);
  commitFile(root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own bookkeeping`);
  return root;
}

function ownPaths(root) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  (land-step-lib/own-paths "${root}" "${head(root)}" "${LANDING}" #{"${SIBLING}"})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const relArb = fc.constantFrom(
  'docs/shared.md',
  'specs/pipeline/steps/shared-thing.js',
  'extension/src/tools/shared-tool.ts',
);

test('BL-1546/BL-654 invariant 1: a closed-owner path is never silently excluded - kept or refused by name', () => {
  const reach = { 'own-touch': 0, 'no-own-touch': 0 };

  for (const shape of Object.keys(reach)) {
    fc.assert(
      fc.property(relArb, (rel) => {
        const root = buildClosedFixture(shape, rel);
        try {
          reach[shape] += 1;
          const result = ownPaths(root);
          if (shape === 'own-touch') {
            assert.equal(result.warning, null, `expected no refusal, got: ${JSON.stringify(result)}`);
            assert.ok((result.paths || []).includes(rel), `expected ${rel} kept, got: ${JSON.stringify(result)}`);
            assert.ok(
              (result.passengers || []).includes(SIBLING),
              `expected the closed sibling as a passenger, got: ${JSON.stringify(result)}`,
            );
          } else {
            assert.equal(result.paths, null, `expected a refusal, got: ${JSON.stringify(result)}`);
            assert.ok(result.warning.includes(rel), `refusal does not name the path: ${result.warning}`);
            assert.ok(result.warning.includes(SIBLING), `refusal does not name the closed sibling: ${result.warning}`);
          }
          assert.ok(
            !(result.excluded || []).some((e) => e.path === rel),
            `the closed-owner path must never be silently EXCLUDED (shape ${shape}): ${JSON.stringify(result)}`,
          );
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

test('BL-1546/BL-654 invariant 2: closed is a positive done-only finding - every other shape falls through to the pre-existing exclusion, unchanged', () => {
  const shapes = ['no-file-at-all', 'active-only', 'both-folders'];
  const reach = Object.fromEntries(shapes.map((s) => [s, 0]));

  for (const shape of shapes) {
    fc.assert(
      fc.property(relArb, (rel) => {
        const root = buildNotClosedFixture(shape, rel);
        try {
          reach[shape] += 1;
          const result = ownPaths(root);
          assert.equal(
            result.warning,
            null,
            `expected the pre-existing silent exclusion, not a refusal (shape ${shape}): ${JSON.stringify(result)}`,
          );
          assert.ok(
            (result.excluded || []).some((e) => e.path === rel && (e.owners || []).includes(SIBLING)),
            `expected ${rel} silently excluded as the sibling's, exactly as before this ticket (shape ${shape}): ${JSON.stringify(result)}`,
          );
          assert.ok(!(result.paths || []).includes(rel), `${rel} must not be kept (shape ${shape}): ${JSON.stringify(result)}`);
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  for (const shape of shapes) {
    assert.ok(reach[shape] > 0, `never exercised the ${shape} shape`);
  }
});
