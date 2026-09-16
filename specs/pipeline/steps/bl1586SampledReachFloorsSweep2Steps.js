'use strict';

// BL-1586: step handlers for "sampled reach floors sweep 2 of 6". Purely
// structural - reads each swept file's source and confirms it derives its
// draw count through runsPerCell and asserts its floor through
// assertReachFloor, both from the shared helpers/reachFloors module (BL-1062).
// No subprocess run: green runs and the floor audit are QA's e2e steps
// (qa_e2e_procedure), not scenarios here - a whole-feature vitest run would
// not fit the per-mutant ceiling (BL-1541).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'BL-1586 sampled reach floors sweep 2 of 6';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// The pinned list (BL-1586 section of
// backlog/evidence/BL-1583-sampled-reach-floor-census-20260915.md) - the
// single source both scenario 01's Examples and scenario 02's count read.
const PINNED_FILES = [
  'extension/test/bl1342CrashloopStampInvariants.property.test.js',
  'extension/test/bl1344WaiveInvariants.property.test.js',
  'extension/test/bl1345StaleMarkerInvariants.property.test.js',
  'extension/test/bl1346RcRepairStampInvariants.property.test.js',
  'extension/test/bl1350KeepaliveInvariants.property.test.js',
  'extension/test/bl1352EscalationVisibilityInvariants.property.test.js',
  'extension/test/bl1354SharedPathLandedSiblingInvariants.property.test.js',
  'extension/test/bl1362ReviewEvidenceByToolInvariants.property.test.js',
  'extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js',
  'extension/test/bl1380ExpediteNeverAnswersUnshownQuestion.property.test.js',
  'extension/test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js',
  'extension/test/bl1460IdleEventsOneSnapshotInvariants.property.test.js',
  'extension/test/bl1481SharedPathContentCheckInvariants.property.test.js',
  'extension/test/bl1538Bl1028RunnerFixtureClosureInvariants.property.test.js',
  'extension/test/bl1546ClosedOwnerNeverSilentlyExcludesInvariants.property.test.js',
  'extension/test/bl687EpicTileSurfaceUntouched.property.test.js',
];

// BL-1362 was matched by the census but carries no genuine reach-floor
// pattern anywhere in the file (every reach counter is an unconditional
// checkpoint in a fixed sequence, never a coverage measure over a drawn
// population) - the recipe's third branch: left unchanged, named here so
// scenario 01 does not mistake this exclusion for a missed migration. See
// backlog/evidence/BL-1586-coder-20260916.md for the full per-file table.
const NOT_A_FLOOR_FILES = new Set(['extension/test/bl1362ReviewEvidenceByToolInvariants.property.test.js']);

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Scenario 01: each swept file derives + asserts through the shared helpers ──
  scoped(/^the source of (.+) is read$/, (ctx, file) => {
    if (!PINNED_FILES.includes(file)) {
      throw new Error(`unknown file example value: "${file}"`);
    }
    ctx.bl1586source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    ctx.bl1586lastFile = file;
  });

  scoped(/^it derives a draw count through runsPerCell from helpers\/reachFloors$/, (ctx) => {
    if (NOT_A_FLOOR_FILES.has(ctx.bl1586lastFile)) return;
    assert.ok(
      /require\(['"]\.\/helpers\/reachFloors['"]\)/.test(ctx.bl1586source) && /runsPerCell\(/.test(ctx.bl1586source),
      `${ctx.bl1586lastFile} does not derive a draw count through runsPerCell from helpers/reachFloors`
    );
  });

  scoped(/^it asserts a reach floor through assertReachFloor from helpers\/reachFloors$/, (ctx) => {
    if (NOT_A_FLOOR_FILES.has(ctx.bl1586lastFile)) return;
    assert.ok(
      /require\(['"]\.\/helpers\/reachFloors['"]\)/.test(ctx.bl1586source) && /assertReachFloor\(/.test(ctx.bl1586source),
      `${ctx.bl1586lastFile} does not assert a reach floor through assertReachFloor from helpers/reachFloors`
    );
  });

  // ── Scenario 02: the pinned list is the census section it was minted from ──
  scoped(/^the BL-1586 pinned file list is read from scenario 01$/, (ctx) => {
    ctx.bl1586pinned = PINNED_FILES;
  });

  scoped(/^it names exactly (\d+) property test files$/, (ctx, count) => {
    assert.equal(
      ctx.bl1586pinned.length,
      Number(count),
      `pinned list has ${ctx.bl1586pinned.length} files, expected ${count}`
    );
  });

  scoped(/^every one of them exists under extension\/test$/, (ctx) => {
    for (const file of ctx.bl1586pinned) {
      assert.ok(
        file.startsWith('extension/test/') && fs.existsSync(path.join(REPO_ROOT, file)),
        `${file} does not exist under extension/test`
      );
    }
  });
}

module.exports = { registerSteps };
