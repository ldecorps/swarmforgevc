'use strict';

// BL-1898: a ticket's land record satisfies the close guard.
// Drives the REAL test_bl1898_land_record_close_guard.sh, which drives the
// REAL commit_integrity_cli.bb over real git fixtures with real land records
// (the BL-1378 handler's shape - a guard decision checked in isolation would
// pass while refusing nothing).

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = "BL-1898 A ticket's land record satisfies the close guard";
const FIXTURE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'swarmforge',
  'scripts',
  'test',
  'test_bl1898_land_record_close_guard.sh'
);

// Explicit KNOWN_VALUES for the Outline rows: an unknown row throws.
const RECORD_MISMATCHES = {
  'names a different ticket': [
    '02 other-ticket: the close is refused',
    '02 other-ticket: as a missing QA approval',
  ],
  'names "BL-9001" with a commit that is not an ancestor of main': [
    '02 not-on-main: the close is refused',
    '02 not-on-main: saying the commit is not on main',
  ],
};

const REFUSALS = {
  mismatch: null,
  'coordinator-note': ['03: the close is refused', '03: as a missing QA approval'],
  'unreadable-store': ['04: the close is refused'],
};

function st(ctx) {
  if (!ctx.bl1898) ctx.bl1898 = {};
  return ctx.bl1898;
}

function runFixture(ctx) {
  const s = st(ctx);
  if (s.out) return s.out;
  const res = spawnSync('bash', [FIXTURE], { encoding: 'utf8', timeout: 600000 });
  s.out = `${res.stdout || ''}${res.stderr || ''}`;
  if (res.status !== 0) throw new Error(`test_bl1898_land_record_close_guard.sh failed (${res.status}):\n${s.out}`);
  return s.out;
}

function requirePass(ctx, marker) {
  const out = runFixture(ctx);
  assert.ok(out.includes(`ok   ${marker}`), `missing "ok   ${marker}" in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a commit moving "BL-9001" from active to done$/, (ctx) => {
    st(ctx);
  });

  scoped(/^the coordinator mailbox holds no QA handoff naming "BL-9001"$/, () => {});

  scoped(/^the coordinator mailbox holds a note from the coordinator naming "BL-9001"$/, (ctx) => {
    st(ctx).case = 'coordinator-note';
  });

  scoped(/^no land record names "BL-9001"$/, () => {});

  scoped(/^a land record names "BL-9001" with a commit that is an ancestor of main$/, (ctx) => {
    st(ctx).case = 'landed';
  });

  scoped(/^a land record that (.+)$/, (ctx, record) => {
    const markers = RECORD_MISMATCHES[record];
    assert.ok(markers, `unknown land record row in the Examples table: ${record}`);
    st(ctx).case = 'mismatch';
    st(ctx).markers = markers;
  });

  scoped(/^the land record store holds a line that is not a record$/, (ctx) => {
    st(ctx).case = 'unreadable-store';
  });

  scoped(/^the close guard validates the commit$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the close is (allowed|refused)$/, (ctx, outcome) => {
    const s = st(ctx);
    if (outcome === 'allowed') {
      assert.equal(s.case, 'landed', `"allowed" is only expected for a landed record, not ${s.case}`);
      requirePass(ctx, '01: the close is allowed');
      return;
    }
    assert.ok(s.case in REFUSALS, `no refusal marker for case ${s.case}`);
    (REFUSALS[s.case] || s.markers).forEach((m) => requirePass(ctx, m));
  });

  scoped(/^the guard names the land record it relied on$/, (ctx) => {
    requirePass(ctx, '01: and the guard names the land record it relied on');
    requirePass(ctx, '01: naming its commit');
  });

  scoped(/^the refusal names the land record store$/, (ctx) => {
    requirePass(ctx, '04: naming the land record store');
  });
}

module.exports = { registerSteps };
