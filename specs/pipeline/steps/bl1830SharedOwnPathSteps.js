'use strict';

// BL-1830: a land never publishes an unlanded sibling's lines inside a file
// the landing ticket also changed.
//
// Every scenario drives the REAL production entry point,
// swarmforge/scripts/land_step_cli.bb - the CLI QA runs - over a REAL
// repository with a REAL origin/main ref, through
// lib/bl1830SharedOwnPathCli.bb. Never the pure land_step_lib.bb functions
// beneath it (same posture as bl1717LandedCoOwnerNeverShieldsSteps.js): a
// driver that calls one function cannot see it disagree with what the CLI
// actually prints and commits.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1830SharedOwnPathCli.bb');

const FEATURE = "BL-1830 A land never publishes an unlanded sibling's lines inside a file the landing ticket also changed";

const U = 'BL-9302';
const MANIFEST = 'swarmforge/scripts/test/suite-manifest.tsv';
const OWN_PATH = 'extension/src/own.ts';

function runFixture(shape) {
  const out = execFileSync('bb', [FIXTURE_CLI, shape], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 900_000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture origin\/main and a reviewed tip for landing ticket BL-9001$/, (ctx) => {
    ctx.bl1830 = {};
  });

  scoped(
    /^unlanded sibling BL-9002 added one row to the shared file "([^"]+)" on the same tip$/,
    (ctx, sharedFile) => {
      assert.equal(sharedFile, MANIFEST, `fixture drives a fixed shared file, expected ${MANIFEST}`);
    }
  );

  // ── Given (per scenario) ───────────────────────────────────────────────
  scoped(/^BL-9001 added its own row to that file$/, (ctx) => {
    ctx.bl1830.shape = 'own-row';
  });

  scoped(/^BL-9001 edited the row BL-9002 added$/, (ctx) => {
    ctx.bl1830.shape = 'edit-sibling-row';
  });

  scoped(/^BL-9001 changed "([^"]+)", which no other ticket touched$/, (ctx, ownPath) => {
    assert.equal(ownPath, OWN_PATH, `fixture drives a fixed own path, expected ${OWN_PATH}`);
    ctx.bl1830.shape = 'unshared';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the land step replays BL-9001$/, (ctx) => {
    ctx.bl1830.report = runFixture(ctx.bl1830.shape);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the replayed file carries BL-9001's row$/, (ctx) => {
    const { report } = ctx.bl1830;
    assert.equal(report.exit, 0, `expected a successful land: ${JSON.stringify(report.lines)}`);
    assert.ok(
      typeof report.manifestContent === 'string' && report.manifestContent.includes('test_bl9301.sh'),
      `expected the replayed manifest to carry BL-9001's row: ${JSON.stringify(report.manifestContent)}`
    );
  });

  scoped(/^it carries no row BL-9002 added$/, (ctx) => {
    const { report } = ctx.bl1830;
    assert.ok(
      typeof report.manifestContent === 'string' && !report.manifestContent.includes('test_bl9302.sh'),
      `expected the replayed manifest to exclude BL-9002's row, but it rode: ${JSON.stringify(report.manifestContent)}`
    );
    assert.ok(
      report.rebuilt.some(([rebuiltPath, sibling]) => rebuiltPath === MANIFEST && sibling === U),
      `expected a SHARED_OWN_PATH_REBUILT line naming ${MANIFEST} and ${U}: ${JSON.stringify(report.rebuilt)}`
    );
  });

  // BL-1830 amend (specifier note, QA bounce 03c4feb156): moved verbatim
  // from BL-1717's own retired scenario 02 ("the report names P as
  // rebuilt, excluding U") - the same SHARED_OWN_PATH_REBUILT assertion,
  // never reworded, just re-homed onto this scenario's own fixture/report.
  scoped(/^the land's report names that file as rebuilt, leaving out BL-9002$/, (ctx) => {
    const { report } = ctx.bl1830;
    assert.ok(
      report.rebuilt.some(([rebuiltPath, sibling]) => rebuiltPath === MANIFEST && sibling === U),
      `no SHARED_OWN_PATH_REBUILT line names ${MANIFEST} and ${U}: ${JSON.stringify(report.lines)}`
    );
  });

  scoped(/^the land escalates naming the file and BL-9002$/, (ctx) => {
    const { report } = ctx.bl1830;
    assert.equal(report.exit, 1, `expected the land to escalate: ${JSON.stringify(report.lines)}`);
    assert.ok(report.lines.includes('LAND_ESCALATE'), `expected LAND_ESCALATE: ${JSON.stringify(report.lines)}`);
    assert.ok(
      typeof report.reason === 'string' && report.reason.includes(MANIFEST),
      `expected the escalation reason to name ${MANIFEST}: ${JSON.stringify(report.reason)}`
    );
    assert.ok(
      typeof report.reason === 'string' && report.reason.includes(U),
      `expected the escalation reason to name ${U}: ${JSON.stringify(report.reason)}`
    );
  });

  scoped(/^the replayed "([^"]+)" is byte-identical to the reviewed tip$/, (ctx, ownPath) => {
    assert.equal(ownPath, OWN_PATH, `fixture drives a fixed own path, expected ${OWN_PATH}`);
    const { report } = ctx.bl1830;
    assert.equal(report.exit, 0, `expected a successful land: ${JSON.stringify(report.lines)}`);
    assert.equal(
      report.ownPathReplayedContent,
      report.ownPathTipContent,
      `expected ${ownPath}'s replayed content to match the reviewed tip byte-for-byte`
    );
  });
}

module.exports = { registerSteps };
