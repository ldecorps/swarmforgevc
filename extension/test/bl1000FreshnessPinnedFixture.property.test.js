'use strict';

// BL-1000 declared invariants (coder-authored per BL-654 / coder.prompt).
// Runs ONLY via `npm run test:properties`.
//
//   1. No freshness shell test binds CONF to the operator's live
//      daemon_log_freshness.conf — every conf seam resolves to a fixture
//      the test owns.
//   2. Every conf path those tests name is tracked in git (fresh clone can run).
//
// GENERATOR REACH: closed set of freshness shell tests this ticket scopes
// (approval_context excludes a repo-wide sweep).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_DIR = path.join(SCRIPTS, 'test');
const LIVE_CONF_ABS = path.join(SCRIPTS, 'daemon_log_freshness.conf');
const FIXTURE_REL =
  'swarmforge/scripts/test/fixtures/daemon_log_freshness.fixture.conf';

const SCOPED_TESTS = [
  'test_daemon_log_freshness.sh',
  'test_bl785_freshness_deliberate_stop.sh',
];

function pathConfAssignments(src) {
  const hits = [];
  const re = /\bCONF=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    hits.push(m[1]);
  }
  return hits;
}

function resolveConfPath(raw) {
  if (raw.includes('$SCRIPT_DIR')) {
    return path.normalize(raw.replaceAll('$SCRIPT_DIR', TEST_DIR));
  }
  if (raw.includes('$SRC')) {
    return path.normalize(raw.replaceAll('$SRC', SCRIPTS));
  }
  return path.normalize(path.isAbsolute(raw) ? raw : path.join(TEST_DIR, raw));
}

test('BL-1000 invariant 1: scoped freshness tests never bind CONF to the live ops file', () => {
  let reached = 0;
  fc.assert(
    fc.property(fc.constantFrom(...SCOPED_TESTS), (name) => {
      reached += 1;
      const abs = path.join(TEST_DIR, name);
      const src = fs.readFileSync(abs, 'utf8');
      const assigns = pathConfAssignments(src);
      assert.ok(assigns.length > 0, `${name}: expected at least one CONF= path assignment`);
      const fixtureAbs = path.resolve(path.join(REPO_ROOT, FIXTURE_REL));
      for (const raw of assigns) {
        const resolved = path.resolve(resolveConfPath(raw));
        // Exact pin — kills live rebinds and non-fixture alternate paths alike.
        assert.equal(resolved, fixtureAbs, `${name} CONF must resolve to pinned fixture, got ${raw} -> ${resolved}`);
        assert.notEqual(resolved, path.resolve(LIVE_CONF_ABS), `${name} binds to live conf via ${raw}`);
      }
    }),
    { numRuns: SCOPED_TESTS.length * 4 }
  );
  assert.ok(reached >= SCOPED_TESTS.length, `generator reach floor: reached=${reached}`);
});

test('BL-1000 invariant 2: every conf path a scoped freshness test reads is git-tracked', () => {
  let reached = 0;
  fc.assert(
    fc.property(fc.constantFrom(...SCOPED_TESTS), (name) => {
      reached += 1;
      const abs = path.join(TEST_DIR, name);
      const src = fs.readFileSync(abs, 'utf8');
      for (const raw of pathConfAssignments(src)) {
        const resolved = resolveConfPath(raw);
        assert.ok(fs.existsSync(resolved), `${name}: missing conf ${resolved}`);
        const rel = path.relative(REPO_ROOT, resolved).replace(/\\/g, '/');
        assert.equal(
          path.resolve(resolved),
          path.resolve(path.join(REPO_ROOT, FIXTURE_REL)),
          `${name}: must read pinned fixture, got ${rel}`
        );
        const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--', rel], {
          encoding: 'utf8',
        }).trim();
        assert.equal(tracked, rel, `${name}: conf not tracked: ${rel}`);
      }
    }),
    { numRuns: SCOPED_TESTS.length * 4 }
  );
  assert.ok(reached >= SCOPED_TESTS.length, `generator reach floor: reached=${reached}`);
});

test('BL-1000: the pinned fixture itself is tracked (fresh-clone property)', () => {
  assert.ok(fs.existsSync(path.join(REPO_ROOT, FIXTURE_REL)), 'fixture file missing');
  const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--', FIXTURE_REL], {
    encoding: 'utf8',
  }).trim();
  assert.equal(tracked, FIXTURE_REL, `fixture not tracked: "${tracked}"`);
});
