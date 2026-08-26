'use strict';

// BL-1023: expeditor adopts (or refuses) a run ticket it cannot bookkeep.
// Drives the REAL test_bl1023_expedite_bookkeep.sh — never a parallel
// reimplementation.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_bl1023_expedite_bookkeep.sh'
);
const FEATURE =
  'an expedited run never reports success with its ticket\'s backlog state unchanged';

function runFixture(ctx) {
  if (ctx.bl1023?.out) return ctx.bl1023.out;
  const res = spawnSync('bash', [FIXTURE], { encoding: 'utf8', timeout: 180000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1023 = { out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`test_bl1023_expedite_bookkeep.sh failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePass(out, marker) {
  assert.match(out, new RegExp(`PASS: ${marker}`), `missing PASS: ${marker}\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an expedited run whose stages all pass$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the run ticket is filed as (active|paused|hold)$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the run completes$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the run reports success$/, (ctx) => {
    requirePass(runFixture(ctx), '01: exit 0 when ticket starts active');
  });

  scoped(/^the run ticket is closed$/, (ctx) => {
    requirePass(runFixture(ctx), '01: the ticket reached done/');
  });

  scoped(
    /^the run does not report success with the run ticket still filed as (paused|hold)$/,
    (ctx, location) => {
      const out = runFixture(ctx);
      if (location === 'paused') {
        requirePass(out, '02a: and lands in done/');
        requirePass(out, '02a: paused/ is empty afterwards');
      } else {
        requirePass(out, '02b: lands in done/');
      }
    }
  );

  scoped(/^the run reaches the end of initiation$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the outcome for that ticket is already decided$/, (ctx) => {
    requirePass(runFixture(ctx), '03: decision names ticket and folder before stages spend');
  });

  scoped(/^the decision names the run ticket and the folder it was found in$/, (ctx) => {
    requirePass(runFixture(ctx), '03: decision names ticket and folder before stages spend');
  });

  scoped(/^another ticket is active work$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the other ticket is parked out of active$/, (ctx) => {
    requirePass(runFixture(ctx), '02b: sibling still parked to hold/');
  });

  scoped(/^a park record names the other ticket$/, (ctx) => {
    requirePass(runFixture(ctx), '02b: park record names the sibling');
  });

  scoped(/^the run completes as a dry run$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^no backlog file has moved$/, (ctx) => {
    const out = runFixture(ctx);
    requirePass(out, '05: dry-run leaves ticket in paused/');
    requirePass(out, '05: dry-run writes nothing to done/');
    requirePass(out, '05: dry-run writes nothing to active/');
  });
}

module.exports = { registerSteps };
