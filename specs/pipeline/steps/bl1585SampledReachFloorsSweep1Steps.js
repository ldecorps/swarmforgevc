'use strict';

// BL-1585: step handlers for "sampled reach floors sweep 1 of 6". Purely
// structural - reads each swept file's source and confirms it derives its
// draw count through runsPerCell and asserts its floor through
// assertReachFloor, both from the shared helpers/reachFloors module (BL-1062).
// No subprocess run: green runs and the floor audit are QA's e2e steps
// (qa_e2e_procedure), not scenarios here - a whole-feature vitest run would
// not fit the per-mutant ceiling (BL-1541).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'BL-1585 sampled reach floors sweep 1 of 6';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// The pinned list (BL-1585 section of
// backlog/evidence/BL-1583-sampled-reach-floor-census-20260915.md) - the
// single source both scenario 01's Examples and scenario 02's count read.
const PINNED_FILES = [
  'extension/test/bl1225SyncRestartTrailInvariants.property.test.js',
  'extension/test/bl1279FrontDeskFixtureClosure.property.test.js',
  'extension/test/bl1280MkdtempMigrationInvariants.property.test.js',
  'extension/test/bl1296BubbleSeatInvariants.property.test.js',
  'extension/test/bl1297MergeOwnPathsInvariants.property.test.js',
  'extension/test/bl1306AuditKeyBasisInvariants.property.test.js',
  'extension/test/bl1309LandDecideEntanglementInvariants.property.test.js',
  'extension/test/bl1323StampOffInvariants.property.test.js',
  'extension/test/bl1327DescentLadderInvariants.property.test.js',
  'extension/test/bl1332SharedPathRefusesInvariants.property.test.js',
  'extension/test/bl1333StampOffInvariants.property.test.js',
  'extension/test/bl1335ExhaustionPromotionInvariants.property.test.js',
  'extension/test/bl1336ForkCeilingInvariants.property.test.js',
  'extension/test/bl1337ProfileCastInvariants.property.test.js',
  'extension/test/bl1339LandApprovalRootInvariants.property.test.js',
  'extension/test/bl1341MergeDropsEitherSideInvariants.property.test.js',
];

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: each swept file derives + asserts through the shared helpers ──
  scoped(/^the source of (.+) is read$/, (ctx, file) => {
    if (!PINNED_FILES.includes(file)) {
      throw new Error(`unknown file example value: "${file}"`);
    }
    ctx.bl1585source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    ctx.bl1585lastFile = file;
  });

  scoped(/^it derives a draw count through runsPerCell from helpers\/reachFloors$/, (ctx) => {
    assert.ok(
      /require\(['"]\.\/helpers\/reachFloors['"]\)/.test(ctx.bl1585source) && /runsPerCell\(/.test(ctx.bl1585source),
      `${ctx.bl1585lastFile} does not derive a draw count through runsPerCell from helpers/reachFloors`
    );
  });

  scoped(/^it asserts a reach floor through assertReachFloor from helpers\/reachFloors$/, (ctx) => {
    assert.ok(
      /require\(['"]\.\/helpers\/reachFloors['"]\)/.test(ctx.bl1585source) && /assertReachFloor\(/.test(ctx.bl1585source),
      `${ctx.bl1585lastFile} does not assert a reach floor through assertReachFloor from helpers/reachFloors`
    );
  });

  // ── Scenario 02: the pinned list is the census section it was minted from ──
  scoped(/^the BL-1585 pinned file list is read from scenario 01$/, (ctx) => {
    ctx.bl1585pinned = PINNED_FILES;
  });

  scoped(/^it names exactly (\d+) property test files$/, (ctx, count) => {
    assert.equal(
      ctx.bl1585pinned.length,
      Number(count),
      `pinned list has ${ctx.bl1585pinned.length} files, expected ${count}`
    );
  });

  scoped(/^every one of them exists under extension\/test$/, (ctx) => {
    for (const file of ctx.bl1585pinned) {
      assert.ok(
        file.startsWith('extension/test/') && fs.existsSync(path.join(REPO_ROOT, file)),
        `${file} does not exist under extension/test`
      );
    }
  });
}

module.exports = { registerSteps };
