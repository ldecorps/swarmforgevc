'use strict';

// BL-1502: step handlers for "The bl1089 fixture-source contract follows the
// liveness fixture it guards".
//
// Scenario 01 drives the REAL property file as a real subprocess under the
// properties config - the only way to prove the file itself is green, not a
// restatement of it (same discipline as bl1550DraftCleanupNeverUnlinksADirectorySteps.js).
// Scenario 02 drives the REAL shared predicate (extension/test/helpers/
// bl1089FixtureSourceContract) against fixture TEXT - the property test and
// this handler both require that SAME module (invariant 1, BL-654); neither
// hand-writes its own copy of the regexes.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkFixtureSourceContract } = require('../../../extension/test/helpers/bl1089FixtureSourceContract');

const FEATURE = 'BL-1502 The bl1089 fixture-source contract follows the liveness fixture it guards';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION = path.join(REPO_ROOT, 'extension');
const PROPERTY_TEST_REL = 'test/bl1089FrontDeskLivenessFixture.property.test.js';
const FIXTURE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_front_desk_supervisor_liveness.sh');

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const KNOWN_FIXTURES = new Set([
  'the liveness fixture as it stands on the tree',
  'a copy of the liveness fixture whose served-then-stopped helper stamps a 5000ms backdate instead of age 0',
]);
const KNOWN_VERDICTS = new Set(['pass', 'fail naming the backdate']);

function buildFixtureText(fixture) {
  const real = fs.readFileSync(FIXTURE, 'utf8');
  if (fixture === 'the liveness fixture as it stands on the tree') {
    return real;
  }
  if (fixture === 'a copy of the liveness fixture whose served-then-stopped helper stamps a 5000ms backdate instead of age 0') {
    const backdated = real.replace(/write_heartbeat "\$root" 0/, 'write_heartbeat "$root" 5000');
    assert.notEqual(backdated, real, 'expected the age-0 stamp line to be present and replaceable in the real fixture');
    return backdated;
  }
  throw new Error(`unknown fixture example value: "${fixture}"`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────────

  scoped(/^extension\/test\/bl1089FrontDeskLivenessFixture\.property\.test\.js runs alone under the properties config$/, (ctx) => {
    if (!ctx.bl1502PropertyRun) {
      ctx.bl1502PropertyRun = spawnSync(
        'npx',
        ['vitest', 'run', '--config', 'vitest.properties.config.mjs', PROPERTY_TEST_REL],
        { cwd: EXTENSION, encoding: 'utf8' }
      );
    }
  });

  scoped(/^every test in it passes$/, (ctx) => {
    const result = ctx.bl1502PropertyRun;
    assert.equal(
      result.status,
      0,
      `expected ${PROPERTY_TEST_REL} to pass under the properties config, got:\n${result.stdout}${result.stderr}`
    );
  });

  // ── Scenario 02 (Outline) ────────────────────────────────────────────────

  scoped(new RegExp(`^(${[...KNOWN_FIXTURES].map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`), (ctx, fixture) => {
    if (!KNOWN_FIXTURES.has(fixture)) {
      throw new Error(`unknown fixture example value: "${fixture}"`);
    }
    ctx.bl1502FixtureText = buildFixtureText(fixture);
  });

  scoped(/^the fixture-source contract is evaluated against that text$/, (ctx) => {
    ctx.bl1502Verdict = checkFixtureSourceContract(ctx.bl1502FixtureText);
  });

  scoped(/^the verdict is (pass|fail naming the backdate)$/, (ctx, verdict) => {
    if (!KNOWN_VERDICTS.has(verdict)) {
      throw new Error(`unknown verdict example value: "${verdict}"`);
    }
    const actual = ctx.bl1502Verdict;
    if (verdict === 'pass') {
      assert.equal(actual.ok, true, `expected the contract to pass, got: ${actual.message}`);
    } else {
      assert.equal(actual.ok, false, 'expected the contract to fail on the backdated fixture');
      assert.match(
        actual.message,
        /backdate/,
        `expected the verdict to name the backdate, got: ${actual.message}`
      );
    }
  });
}

module.exports = { registerSteps };
