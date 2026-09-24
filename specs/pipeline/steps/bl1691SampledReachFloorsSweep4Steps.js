'use strict';

// BL-1691: step handlers for "sampled reach floors sweep 4 of 6". Scenario
// 01 reads each pinned file's own real source text and checks for the
// shared helper's own two call sites (runsPerCell/assertReachFloor) -
// never a reimplementation of BL-1584's classifier. Scenario 02 drives the
// REAL sampled_reach_floor_census_cli.bb against the real repo tree, the
// same classifier the gate and every prior sweep already use.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1691 sampled reach floors sweep 4 of 6';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CENSUS_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'sampled_reach_floor_census_cli.bb');

// The pinned list, in the ticket's own census order (BL-1445) - the same
// 15 files scenario 01's own Examples table names.
const PINNED_FILES = [
  'extension/test/bl1210IconMarkerStoreInvariants.property.test.js',
  'extension/test/bl1243PaneActivityInvariants.property.test.js',
  'extension/test/bl1340SelfConvertingDraftInvariants.property.test.js',
  'extension/test/bl1356StampOffInvariants.property.test.js',
  'extension/test/bl1365RitualLedgerInvariants.property.test.js',
  'extension/test/bl1383ProviderChatSeatInvariants.property.test.js',
  'extension/test/bl1384LocalSeatTopicForwardedInvariants.property.test.js',
  'extension/test/bl1398GuardFixtureDerivedSet.property.test.js',
  'extension/test/bl1402FrontDeskPhotoPassthroughInvariants.property.test.js',
  'extension/test/bl1455RependedApprovalAskInvariants.property.test.js',
  'extension/test/bl1471BounceRevertScopeInvariants.property.test.js',
  'extension/test/bl1477ContextTelemetryTornTailInvariants.property.test.js',
  'extension/test/bl1484HookFixturesDeriveTheirSet.property.test.js',
  'extension/test/bl1539SelfRootingDerivationStability.property.test.js',
  'extension/test/bl1565CoordinatorNeverReceivesGitHandoffInvariants.property.test.js',
];

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ───────────────────────────────────────────────────────────
  scoped(/^the source of (\S+) is read$/, (ctx, file) => {
    ctx.file = file;
    ctx.source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  });

  scoped(/^it derives a draw count through runsPerCell from helpers\/reachFloors$/, (ctx) => {
    assert.match(
      ctx.source,
      /require\(['"]\.\/helpers\/reachFloors['"]\)/,
      `${ctx.file} does not require ./helpers/reachFloors`
    );
    assert.match(ctx.source, /runsPerCell\(/, `${ctx.file} never calls runsPerCell(`);
  });

  scoped(/^it asserts a reach floor through assertReachFloor from helpers\/reachFloors$/, (ctx) => {
    assert.match(ctx.source, /assertReachFloor\(/, `${ctx.file} never calls assertReachFloor(`);
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────────
  scoped(/^the BL-1691 pinned file list is read from scenario 01$/, (ctx) => {
    ctx.pinned = PINNED_FILES;
  });

  scoped(/^it names exactly 15 property test files$/, (ctx) => {
    assert.equal(ctx.pinned.length, 15, `expected exactly 15 pinned files, got ${ctx.pinned.length}`);
  });

  scoped(/^every one of them exists under extension\/test$/, (ctx) => {
    for (const file of ctx.pinned) {
      assert.ok(file.startsWith('extension/test/'), `${file} is not under extension/test`);
      assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `${file} does not exist`);
    }
  });

  scoped(/^the sampled reach floor census CLI reads every one of them as constructed$/, (ctx) => {
    const result = spawnSync('bb', [CENSUS_CLI, '.'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, `census CLI failed: ${result.stderr}`);
    const rows = new Map(
      result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [file, verdict] = line.split('\t');
          return [file, verdict];
        })
    );
    for (const file of ctx.pinned) {
      assert.equal(rows.get(file), 'constructed', `${file} reads "${rows.get(file)}", expected "constructed"`);
    }
  });
}

module.exports = { registerSteps };
