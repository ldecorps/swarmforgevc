'use strict';

// BL-1092: step handlers for "The repo-creation guard recognises a creation
// by what it does". Drives the real repoCreationGuard helper.

const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE = 'The repo-creation guard recognises a creation by what it does';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const {
  createsRepository,
  findRepoCreations,
  exemptionReason,
  violationFor,
} = require(path.join(REPO_ROOT, 'extension', 'test', 'helpers', 'repoCreationGuard'));

const KNOWN_HELPERS = new Set(['git', 'runGit', 'g', 'runTar']);
const KNOWN_SPAWNS = new Set(['git', 'tar']);
const KNOWN_VERDICTS = new Set(['flagged', 'not flagged']);
const KNOWN_ROWS = new Set([
  'git|git|flagged',
  'runGit|git|flagged',
  'g|git|flagged',
  'runTar|tar|not flagged',
]);
const SITUATION_FIXTURES = {
  'a whole-line string literal describing file content':
    "  \"execFileSync('git', ['init', '-q'], { cwd: root });\",",
  "the shared fixture helper's own internal spawn": "gitIn(dir, ['init', '-q']);",
  'accompanied by a recorded exemption reason':
    "// BL-1039-EXEMPT: asserts on a repo it must create itself\ngit(dir, ['init', '-q']);",
};
const KNOWN_SITUATIONS = new Set(Object.keys(SITUATION_FIXTURES));

// Frozen pre-change corpus verdict (measured empty once exemptions apply).
const PRE_CHANGE_VIOLATIONS = [];

function fixtureFor(helper, spawns) {
  const bin = spawns === 'git' ? 'git' : 'tar';
  return [
    `function ${helper}(cwd, args) { execFileSync("${bin}", args, { cwd }); }`,
    `${helper}(dir, ['init', '-q']);`,
  ].join('\n');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a test file defining a local helper named (\S+) that spawns (\S+)$/, (ctx, helper, spawns) => {
    assert.ok(KNOWN_HELPERS.has(helper), `unknown <helper>: ${helper}`);
    assert.ok(KNOWN_SPAWNS.has(spawns), `unknown <spawns>: ${spawns}`);
    ctx.helper = helper;
    ctx.spawns = spawns;
  });

  scoped(/^that file calls (\S+) with an init argument$/, (ctx, helper) => {
    assert.equal(helper, ctx.helper);
    ctx.fileText = fixtureFor(ctx.helper, ctx.spawns);
  });

  scoped(/^the repo-creation guard scans the file$/, (ctx) => {
    ctx.flagged = createsRepository(ctx.fileText);
  });

  scoped(/^the file is (flagged|not flagged) as creating a repository$/, (ctx, verdict) => {
    assert.ok(KNOWN_VERDICTS.has(verdict), `unknown <verdict>: ${verdict}`);
    // Scenario 02 uses the same trailing phrase without an Outline helper row.
    if (ctx.helper === undefined) {
      if (ctx.situation === 'accompanied by a recorded exemption reason') {
        assert.ok(createsRepository(ctx.fileText));
        assert.ok(exemptionReason(ctx.fileText));
        assert.equal(violationFor('x.test.js', ctx.fileText), null);
        return;
      }
      assert.equal(createsRepository(ctx.fileText), false);
      return;
    }
    const rowKey = `${ctx.helper}|${ctx.spawns}|${verdict}`;
    assert.ok(KNOWN_ROWS.has(rowKey), `unknown Outline row: ${rowKey}`);
    assert.equal(ctx.flagged, verdict === 'flagged');
  });

  scoped(/^a test file whose init call is (.+)$/, (ctx, situation) => {
    const cell = situation.trim();
    assert.ok(KNOWN_SITUATIONS.has(cell), `unknown <situation>: ${cell}`);
    ctx.situation = cell;
    ctx.fileText = SITUATION_FIXTURES[cell];
  });

  scoped(/^the unit-lane test corpus as it stands$/, (ctx) => {
    ctx.testDir = path.join(REPO_ROOT, 'extension', 'test');
  });

  scoped(/^the repo-creation guard scans every test file$/, (ctx) => {
    ctx.violations = findRepoCreations(ctx.testDir);
  });

  scoped(/^the reported violations are exactly those reported before the change$/, (ctx) => {
    assert.deepEqual(ctx.violations, PRE_CHANGE_VIOLATIONS);
  });
}

module.exports = { registerSteps };
