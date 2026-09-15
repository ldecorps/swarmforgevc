'use strict';

// BL-1575: step handlers for "the b.ai gateway seat handler imports the
// fixture-root helper it calls". BL-1410's migration (046a7d9b84,
// 2026-09-09) rewrote bl1495BaiGatewaySeatSteps.js's three mkTmpDir calls
// into mkSocketFixtureRoot calls but never added the require its ten
// migration siblings received, leaving the BL-1495 feature red on main
// since. Scenario 01 reads the handler as text; scenario 02 runs the REAL
// BL-1495 feature under the REAL acceptance runner (never a JS
// restatement of its scenarios); scenario 03 derives the lane's caller
// census structurally, the same shape as BL-1445/BL-1485's sibling
// handlers.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEPS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');
const FEATURES_DIR = path.join(REPO_ROOT, 'specs', 'features');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const BL1495_HANDLER = path.join(STEPS_DIR, 'bl1495BaiGatewaySeatSteps.js');

const FEATURE = 'BL-1575 The b.ai gateway seat handler imports the fixture-root helper it calls';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function findFeatureFile(ticket) {
  const features = fs.readdirSync(FEATURES_DIR)
    .filter((f) => f.startsWith(ticket) && f.endsWith('.feature'));
  if (features.length === 0) {
    throw new Error(`No feature file found for ${ticket}`);
  }
  return path.join(FEATURES_DIR, features[0]);
}

// The census this ticket's invariant and scenario 03 both rest on: every
// step handler that calls the fixture-root helper must require it from
// ./lib/socketFixtureRoot - the same literal-substring shape as the
// ticket's own verification grep (`grep -l 'mkSocketFixtureRoot(' | xargs
// grep -L socketFixtureRoot`), never a hardcoded list. This file itself is
// excluded from its own census: its error strings and comments necessarily
// name the call/require text it checks for in OTHER files, which would
// otherwise misreport it as a non-importing caller of itself. A fuzzy
// (whitespace-tolerant) pattern was tried and rejected - it false-matched
// prose like "mkSocketFixtureRoot (which cleans up...)" in a comment.
const CALL_TEXT = 'mkSocketFixtureRoot(';
const REQUIRE_PATTERN = /require\(['"]\.\/lib\/socketFixtureRoot['"]\)/;
const SELF = path.basename(__filename);

function census() {
  const files = fs.readdirSync(STEPS_DIR).filter((f) => f.endsWith('.js') && f !== SELF);
  const callers = [];
  const missingRequire = [];
  for (const f of files) {
    const abs = path.join(STEPS_DIR, f);
    const content = fs.readFileSync(abs, 'utf8');
    if (!content.includes(CALL_TEXT)) continue;
    callers.push(f);
    if (!REQUIRE_PATTERN.test(content)) missingRequire.push(f);
  }
  return { callers, missingRequire };
}

function registerSteps(registry) {
  // ── scenario 01 ─────────────────────────────────────────────────────
  scoped(registry, /^the file specs\/pipeline\/steps\/bl1495BaiGatewaySeatSteps\.js is read as code$/, (ctx) => {
    ctx.bl1495Content = fs.readFileSync(BL1495_HANDLER, 'utf8');
  });

  scoped(registry, /^it requires mkSocketFixtureRoot from the steps-lane helper lib\/socketFixtureRoot$/, (ctx) => {
    assert.match(
      ctx.bl1495Content,
      /const\s*{\s*mkSocketFixtureRoot\s*}\s*=\s*require\(['"]\.\/lib\/socketFixtureRoot['"]\)/,
      'expected bl1495BaiGatewaySeatSteps.js to require mkSocketFixtureRoot from ./lib/socketFixtureRoot'
    );
  });

  // ── scenario 02 ─────────────────────────────────────────────────────
  scoped(registry, /^the feature for "([^\x22]+)" runs under the acceptance runner$/, (ctx, ticket) => {
    const featureFile = findFeatureFile(ticket);
    const outDir = path.join(REPO_ROOT, 'tmp', 'bl1575-out');
    const r = spawnSync('bash', [RUN_ACCEPTANCE, featureFile, outDir], { encoding: 'utf8' });
    ctx.acceptanceResult = { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
  });

  scoped(registry, /^every one of its 7 scenario runs passes$/, (ctx) => {
    assert.equal(
      ctx.acceptanceResult.status,
      0,
      `expected the feature to pass under the acceptance runner:\n${ctx.acceptanceResult.out}`
    );
    assert.match(ctx.acceptanceResult.out, /# pass 7/, `expected all seven scenario runs to pass:\n${ctx.acceptanceResult.out}`);
    assert.match(ctx.acceptanceResult.out, /# fail 0/, `expected no failing runs:\n${ctx.acceptanceResult.out}`);
  });

  // ── scenario 03 ─────────────────────────────────────────────────────
  scoped(registry, /^every step handler under specs\/pipeline\/steps that calls mkSocketFixtureRoot is collected$/, (ctx) => {
    ctx.census = census();
  });

  scoped(
    registry,
    /^the collection holds at least 123 handlers including bl1495BaiGatewaySeatSteps\.js and bl802BabysitterdMacosPortabilitySteps\.js$/,
    (ctx) => {
      assert.ok(
        ctx.census.callers.length >= 123,
        `expected at least 123 handlers calling mkSocketFixtureRoot(, found ${ctx.census.callers.length}`
      );
      assert.ok(ctx.census.callers.includes('bl1495BaiGatewaySeatSteps.js'), 'expected bl1495BaiGatewaySeatSteps.js in the caller census');
      assert.ok(ctx.census.callers.includes('bl802BabysitterdMacosPortabilitySteps.js'), 'expected bl802BabysitterdMacosPortabilitySteps.js in the caller census');
    }
  );

  scoped(registry, /^no member of the collection is missing the require of lib\/socketFixtureRoot$/, (ctx) => {
    assert.deepEqual(
      ctx.census.missingRequire,
      [],
      `handler(s) call mkSocketFixtureRoot( without requiring it from ./lib/socketFixtureRoot: ${ctx.census.missingRequire.join(', ')}`
    );
  });
}

module.exports = { registerSteps };
