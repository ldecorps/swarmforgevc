'use strict';

// BL-1332's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A replayed path's content never carries a change attributed
//                solely to a ticket the same run reported as unlanded,
//                whatever else that path is attributed to.
//   invariant 2  A shared path whose ownership cannot be separated refuses
//                the land, naming the path and the sibling; it never
//                silently ships either ticket's version of it.
//
// Drives the REAL swarmforge/scripts/land_step_lib.bb against real git
// fixtures - never a JavaScript restatement of the decision.
//
// GENERATOR REACH (reached by construction, never by draw - the discipline
// two architect bounces on this same session established). The defect lives
// in ONE shape: a path BOTH the landing ticket and an unlanded sibling
// touched. Each ownership shape gets its OWN property pass - landing-only,
// sibling-only, unattributed, shared-with-unlanded, shared-with-landed - so
// every corner is exercised in every run and the floors below hold because
// the shapes ran, not because a draw was lucky.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_STEP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const FIXTURE_PREFIX = 'bl1332-property-';
const LANDING = 'BL-9332';
const UNLANDED = 'BL-9333';
const LANDED_SIBLING = 'BL-9334';
const SIBLING_LINE = 'sibling-only-line';

const SHAPES = ['landing-only', 'unlanded-only', 'unattributed', 'shared-with-unlanded', 'shared-with-landed'];

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function head(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function buildFixture(shape, rel) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));

  // The landing ticket always contributes an anchor path of its own, so an
  // empty contribution never stands in for the disposition under test.
  commitFile(root, 'landing/anchor.txt', 'anchor\n', `${LANDING}: anchor path`);

  switch (shape) {
    case 'landing-only':
      commitFile(root, rel, 'landing\n', `${LANDING}: own work on ${rel}`);
      break;
    case 'unlanded-only':
      commitFile(root, rel, `${SIBLING_LINE}\n`, `${UNLANDED}: sibling-only work on ${rel}`);
      break;
    case 'unattributed':
      commitFile(root, rel, 'nobody\n', `housekeeping touching ${rel}`);
      break;
    case 'shared-with-unlanded':
      commitFile(root, rel, 'base\n', `${LANDING}: own work on ${rel}`);
      commitFile(root, rel, `base\n${SIBLING_LINE}\n`, `${UNLANDED}: sibling's line in the same file`);
      break;
    case 'shared-with-landed':
      commitFile(root, rel, 'base\n', `${LANDING}: own work on ${rel}`);
      commitFile(root, rel, 'base\nlanded sibling line\n', `${LANDED_SIBLING}: a sibling that already landed`);
      break;
    default:
      throw new Error(`unknown shape: ${shape}`);
  }
  return root;
}

function ownPaths(root) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${LAND_STEP_LIB}")
(println (json/generate-string
  (land-step-lib/own-paths "${root}" "${head(root)}" "${LANDING}" #{"${UNLANDED}"})))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// The content of a path as the replay would take it: the whole blob at the
// cited commit, which is precisely why a shared path cannot be separated.
function blobAtTip(root, rel) {
  return execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf8' });
}

const relArb = fc.constantFrom(
  'specs/pipeline/steps/index.js',
  'swarmforge/scripts/test/suite-manifest.tsv',
  'docs/reference/backlog-schema.md',
);

test('BL-1332/BL-654 invariant 1: no replayed path ever carries a change attributed solely to an unlanded ticket', () => {
  const reach = Object.fromEntries(SHAPES.map((s) => [s, 0]));

  for (const shape of SHAPES) {
    fc.assert(
      fc.property(relArb, (rel) => {
        const root = buildFixture(shape, rel);
        try {
          reach[shape] += 1;
          const result = ownPaths(root);
          const paths = result.paths || [];

          for (const p of paths) {
            // Whatever survives into the replay set is taken WHOLE, so its
            // blob must contain nothing that only the unlanded sibling wrote.
            assert.ok(
              !blobAtTip(root, p).includes(SIBLING_LINE),
              `${p} would ship the unlanded sibling's line (shape ${shape})`,
            );
          }
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

test('BL-1332/BL-654 invariant 2: an inseparable shared path refuses, naming path and sibling, and ships neither version', () => {
  const reach = { refused: 0, allowed: 0 };

  for (const shape of SHAPES) {
    fc.assert(
      fc.property(relArb, (rel) => {
        const root = buildFixture(shape, rel);
        try {
          const result = ownPaths(root);
          const shared = shape === 'shared-with-unlanded';

          if (shared) {
            reach.refused += 1;
            assert.equal(result.paths, null, `a shared path did not refuse: ${JSON.stringify(result)}`);
            const warning = result.warning || '';
            assert.ok(warning.includes(rel), `the refusal does not name the path: ${warning}`);
            assert.ok(warning.includes(UNLANDED), `the refusal does not name the sibling: ${warning}`);
            assert.ok(warning.includes(LANDING), `the refusal does not name the landing ticket: ${warning}`);
          } else {
            reach.allowed += 1;
            // Every other shape keeps BL-1315's landed behaviour: a decision,
            // not a refusal. A fix that refused everything would satisfy
            // invariant 1 and be useless.
            assert.ok(Array.isArray(result.paths), `shape ${shape} refused, which BL-1315 did not: ${JSON.stringify(result)}`);
            assert.equal(result.warning, null);
            if (shape === 'unlanded-only') {
              assert.ok(!result.paths.includes(rel), `${rel} is the sibling's alone and must stay excluded`);
            } else {
              assert.ok(result.paths.includes(rel), `${rel} should still replay under shape ${shape}`);
            }
          }
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 },
    );
  }

  assert.ok(reach.refused > 0, 'never exercised the shared-path refusal - the defect corner went untested');
  assert.ok(reach.allowed > 0, 'never exercised a non-shared path - BL-1315 regression cover went untested');
});
