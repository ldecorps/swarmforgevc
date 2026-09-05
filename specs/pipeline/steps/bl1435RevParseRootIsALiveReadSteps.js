'use strict';

// BL-1435: step handlers for "a root derived through git rev-parse is a
// live read the guard can see". Drives the REAL
// extension/test/helpers/liveRepoDerivationGuard.js (never a
// reimplementation) against fixture TEXT for scenarios 01-02 (BL-1038's
// own convention), and against the REAL extension/test tree for scenario
// 03 - a read-only live-tree read, justified because the tree at this
// commit is the contract (the same posture the guard's own unit test
// takes).
const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  liveRepoDerivation,
  violationFor,
  findLiveRepoDerivations,
} = require(path.join(EXT_DIR, 'test', 'helpers', 'liveRepoDerivationGuard'));

const FEATURE = 'BL-1435 A root derived through git rev-parse is a live read the guard can see';

const CALL_SNIPPETS = {
  'execFileSync git rev-parse --show-toplevel':
    "execFileSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()",
  'execSync git rev-parse --show-toplevel':
    "execSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()",
  'spawnSync git rev-parse --show-toplevel':
    "spawnSync('git', ['-C', __dirname, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()",
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^the BL-1038 live-repository derivation guard$/, () => {
    // Framing only - the real guard module is required once above; every
    // scenario drives it directly, never a fixture copy.
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^a test that resolves its root with (.+) and walks git log against that root$/, (ctx, call) => {
    const snippet = CALL_SNIPPETS[call];
    if (!snippet) {
      throw new Error(`unknown <call>: ${call}`);
    }
    ctx.text = [`const REPO = ${snippet};`, "execSync('git log --format=%H', { cwd: REPO });"].join('\n');
  });

  scoped(/^the guard inspects it$/, (ctx) => {
    ctx.derivation = liveRepoDerivation(ctx.text);
  });

  scoped(/^it is named as a violation that walks live git history$/, (ctx) => {
    assert.ok(ctx.derivation, `expected a violation, got: ${JSON.stringify(ctx.derivation)}`);
    assert.match(ctx.derivation, /history depth/);
  });

  // ── Scenario 02 (Outline) ────────────────────────────────────────────
  scoped(/^a rev-parse-rooted test whose exemption marker is (.+)$/, (ctx, marker) => {
    const base = [
      `const REPO = ${CALL_SNIPPETS['execFileSync git rev-parse --show-toplevel']};`,
      'fs.readdirSync(path.join(REPO, \'docs\'));',
    ].join('\n');
    if (marker === 'followed by a written reason') {
      ctx.text = '// BL-1038-EXEMPT: the live read is the assertion\n' + base;
    } else if (marker === 'bare, with nothing after it') {
      ctx.text = '// BL-1038-EXEMPT:\n' + base;
    } else {
      throw new Error(`unknown <marker>: ${marker}`);
    }
  });

  scoped(/^it is (treated as exempt|reported as a violation)$/, (ctx, verdict) => {
    const v = violationFor('scratch.test.js', ctx.text);
    if (verdict === 'treated as exempt') {
      assert.equal(v, null, `expected no violation, got: ${JSON.stringify(v)}`);
    } else {
      assert.ok(v, 'expected a violation for the bare marker');
    }
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^the guard runs over the parcel's own extension test tree$/, (ctx) => {
    ctx.violations = findLiveRepoDerivations(path.join(EXT_DIR, 'test'));
  });

  scoped(/^it reports no violations$/, (ctx) => {
    assert.deepEqual(ctx.violations, [], `expected a clean tree, got: ${JSON.stringify(ctx.violations)}`);
  });

  scoped(/^every file binding its root through git rev-parse --show-toplevel either carries a reasoned exemption or reads no live growth surface$/, () => {
    // Documented by the previous step's own empty result: findLiveRepoDerivations
    // already scans every file for exactly this (a derivation with no
    // honoured exemption is a violation) - a second, redundant pass here
    // would just re-derive the same answer.
  });
}

module.exports = { registerSteps };
