'use strict';

// BL-1587: step handlers for "sampled reach floors sweep 3 of 6". Purely
// structural - reads each swept file's source and confirms it derives its
// draw count through runsPerCell and asserts its floor through
// assertReachFloor, both from the shared helpers/reachFloors module (BL-1062).
// No subprocess run: green runs and the floor audit are QA's e2e steps
// (qa_e2e_procedure), not scenarios here - a whole-feature vitest run would
// not fit the per-mutant ceiling (BL-1541).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'BL-1587 sampled reach floors sweep 3 of 6';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// The pinned list (BL-1587 section of
// backlog/evidence/BL-1583-sampled-reach-floor-census-20260915.md) - the
// single source both scenario 01's Examples and scenario 02's count read.
const PINNED_FILES = [
  'extension/test/bl1218RemoteControlConfigInvariants.property.test.js',
  'extension/test/bl1239SuiteManifestAccountsForEveryTestFile.property.test.js',
  'extension/test/bl1254LedgerCertificationNeedsAHuman.property.test.js',
  'extension/test/bl1275RefusalEvidenceInvariants.property.test.js',
  'extension/test/bl1305FixtureAgentBinary.property.test.js',
  'extension/test/bl1308SiblingDetectorCoversReplay.property.test.js',
  'extension/test/bl1315OwnPathsFullRangeInvariants.property.test.js',
  'extension/test/bl1317AdaptEffortInvariants.property.test.js',
  'extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js',
  'extension/test/bl1445StaffingGateWiringTestDecidesOverrideInvariants.property.test.js',
  'extension/test/bl1495BaiGatewayInvariants.property.test.js',
];

// BL-1305 was matched by the census but carries no genuine reach-floor
// pattern anywhere in the file - invariant 1's property has no reach
// counter at all, and the "reach floor" test named in its header comment is
// a fixed, hand-written non-vacuity check with no fc.property/numRuns and
// no per-category count assertion - the recipe's third branch: left
// unchanged, named here so scenario 01 does not mistake this exclusion for
// a missed migration. See backlog/evidence/BL-1587-coder-20260916.md for
// the full per-file table.
const NOT_A_FLOOR_FILES = new Set(['extension/test/bl1305FixtureAgentBinary.property.test.js']);

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: each swept file derives + asserts through the shared helpers ──
  scoped(/^the source of (.+) is read$/, (ctx, file) => {
    if (!PINNED_FILES.includes(file)) {
      throw new Error(`unknown file example value: "${file}"`);
    }
    ctx.bl1587source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    ctx.bl1587lastFile = file;
  });

  scoped(/^it derives a draw count through runsPerCell from helpers\/reachFloors$/, (ctx) => {
    if (NOT_A_FLOOR_FILES.has(ctx.bl1587lastFile)) return;
    assert.ok(
      /require\(['"]\.\/helpers\/reachFloors['"]\)/.test(ctx.bl1587source) && /runsPerCell\(/.test(ctx.bl1587source),
      `${ctx.bl1587lastFile} does not derive a draw count through runsPerCell from helpers/reachFloors`
    );
  });

  scoped(/^it asserts a reach floor through assertReachFloor from helpers\/reachFloors$/, (ctx) => {
    if (NOT_A_FLOOR_FILES.has(ctx.bl1587lastFile)) return;
    assert.ok(
      /require\(['"]\.\/helpers\/reachFloors['"]\)/.test(ctx.bl1587source) && /assertReachFloor\(/.test(ctx.bl1587source),
      `${ctx.bl1587lastFile} does not assert a reach floor through assertReachFloor from helpers/reachFloors`
    );
  });

  // ── Scenario 02: the pinned list is the census section it was minted from ──
  scoped(/^the BL-1587 pinned file list is read from scenario 01$/, (ctx) => {
    ctx.bl1587pinned = PINNED_FILES;
  });

  scoped(/^it names exactly (\d+) property test files$/, (ctx, count) => {
    assert.equal(
      ctx.bl1587pinned.length,
      Number(count),
      `pinned list has ${ctx.bl1587pinned.length} files, expected ${count}`
    );
  });

  scoped(/^every one of them exists under extension\/test$/, (ctx) => {
    for (const file of ctx.bl1587pinned) {
      assert.ok(
        file.startsWith('extension/test/') && fs.existsSync(path.join(REPO_ROOT, file)),
        `${file} does not exist under extension/test`
      );
    }
  });
}

module.exports = { registerSteps };
