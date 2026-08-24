'use strict';

// BL-1084: superseded task stops at every stage. Drives REAL
// test_supersede_guard.sh (ready_for_next.bb supersede guard) — never a
// parallel reimplementation.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_supersede_guard.sh'
);
const FEATURE =
  'A superseded task stops at every stage, not only the one a note reached';

function runFixture(ctx) {
  if (ctx.bl1084?.out) return ctx.bl1084.out;
  const res = spawnSync('bash', [FIXTURE], { encoding: 'utf8', timeout: 120000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1084 = { out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`test_supersede_guard.sh failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePass(out, marker) {
  assert.match(out, new RegExp(`PASS: ${marker}`), `missing PASS: ${marker}\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // Background + scenario givens are satisfied by the fixture; steps assert
  // the corresponding PASS markers (and that the fixture ran once).
  scoped(/^a supersede is recorded for task "([^"]+)" with reason "([^"]+)"$/, (ctx) => {
    ctx.bl1084 = ctx.bl1084 || {};
    runFixture(ctx);
  });

  scoped(/^role "([^"]+)" has a parcel for task "([^"]+)" in its inbox$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^role "([^"]+)" starts a turn$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the turn is refused$/, (ctx) => {
    const out = runFixture(ctx);
    assert.match(out, /PASS: 01:|PASS: 03:|PASS: 05b:|PASS: 06:/, out);
  });

  scoped(
    /^the refusal names the task "([^"]+)" and the reason "([^"]+)"$/,
    (ctx) => {
      // Fixture scenario 01 already asserts STDERR names task+reason per role.
      requirePass(runFixture(ctx), '01: every stage refuses a parcel for a superseded task');
    }
  );

  scoped(/^the parcel is still in role "([^"]+)"'s inbox$/, (ctx) => {
    requirePass(runFixture(ctx), '01: every stage refuses a parcel for a superseded task');
  });

  scoped(/^the turn is not refused$/, (ctx) => {
    const out = runFixture(ctx);
    assert.match(out, /PASS: 02:|PASS: 04:|PASS: 05a:/, out);
  });

  scoped(/^the parcel for task "([^"]+)" is dispatched normally$/, (ctx) => {
    const out = runFixture(ctx);
    assert.match(out, /PASS: 02:|PASS: 04:/, out);
  });

  scoped(/^no bounce is recorded against role "([^"]+)"$/, (ctx) => {
    requirePass(runFixture(ctx), '03: a refused parcel is not recorded as a bounce');
  });

  scoped(/^the recorded supersede for task "([^"]+)" is deleted by hand$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the supersede marker store is (absent|unreadable)$/, (ctx, state) => {
    ctx.bl1084 = ctx.bl1084 || {};
    ctx.bl1084.storeState = state;
    runFixture(ctx);
  });

  scoped(/^the turn is (not refused|refused)$/, (ctx, outcome) => {
    const out = runFixture(ctx);
    if (outcome === 'not refused') {
      requirePass(out, '05a: absent store is not refused');
    } else if (ctx.bl1084?.storeState === 'unreadable') {
      requirePass(out, '05b: unreadable store is refused');
    } else {
      assert.match(out, /PASS: 01:|PASS: 03:|PASS: 05b:|PASS: 06:/, out);
    }
  });

  scoped(/^role "([^"]+)" receives work in batch mode$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^no batch is assembled$/, (ctx) => {
    requirePass(runFixture(ctx), '06: the guard runs before dispatch chooses task or batch mode');
  });
}

module.exports = { registerSteps };
