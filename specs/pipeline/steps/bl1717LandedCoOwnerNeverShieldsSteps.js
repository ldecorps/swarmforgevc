'use strict';

// BL-1717: a landed co-owner never shields an unlanded sibling's lines on
// the same path.
//
// Every scenario drives the REAL production entry point,
// swarmforge/scripts/land_step_cli.bb - the CLI QA runs - over a REAL
// repository with a REAL origin/main ref, through
// lib/bl1717LandedCoOwnerCli.bb. Never the pure lib functions beneath it:
// the BL-1687/35ef2dbcd2 incident was a decision made against a verdict
// computed elsewhere, and a driver that calls one function cannot see the
// two disagree.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1717LandedCoOwnerCli.bb');

const FEATURE = "BL-1717 A landed co-owner never shields an unlanded sibling's lines";

const L = 'BL-9201';
const U = 'BL-9202';
const A = 'BL-9203';
const P = 'docs/reference/BL-1717-shared.md';
const Q = `backlog/active/${A}-own.yaml`;

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
  scoped(
    /^a fixture origin where landed ticket L and unlanded approved ticket U both changed path P, and landing ticket A changed its own path Q$/,
    (ctx) => {
      ctx.bl1717 = { shape: 'not-shared' };
    }
  );

  // ── Given (scenario 02) ────────────────────────────────────────────────
  scoped(/^A's own commit also changed P$/, (ctx) => {
    ctx.bl1717.shape = 'shared';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the land step plans A's land$/, (ctx) => {
    ctx.bl1717.report = runFixture(ctx.bl1717.shape);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the built commit's diff against origin\/main names Q and not P$/, (ctx) => {
    const { report } = ctx.bl1717;
    assert.ok(
      report.replayPaths.includes(Q),
      `expected the landing ticket's own path in the replay: ${JSON.stringify(report.replayPaths)}`
    );
    assert.ok(
      !report.replayPaths.includes(P),
      `expected the shared path to be excluded from the replay, but it rode: ${JSON.stringify(report.replayPaths)}`
    );
  });

  scoped(/^the report names P as excluded, credited to U$/, (ctx) => {
    const { report } = ctx.bl1717;
    assert.ok(
      report.excluded.some(([excludedPath, owner]) => excludedPath === P && owner === U),
      `no EXCLUDED_SIBLING_PATH line names ${P} and ${U}: ${JSON.stringify(report.excluded)}`
    );
  });

  scoped(/^the built commit's diff against origin\/main names P and Q$/, (ctx) => {
    const { report } = ctx.bl1717;
    for (const p of [P, Q]) {
      assert.ok(
        report.replayPaths.includes(p),
        `expected ${p} in the replay: ${JSON.stringify(report.replayPaths)}`
      );
    }
  });

  scoped(/^the report names U as a passenger$/, (ctx) => {
    const { report } = ctx.bl1717;
    assert.ok(
      report.passengers.includes(U),
      `${U} did not ride as a passenger: ${JSON.stringify(report.lines)}`
    );
  });
}

module.exports = { registerSteps };
