'use strict';

// BL-1898 declared invariants (coder first authorship - BL-654):
//   1. "A land record opens the close only of the ticket it names, and only
//      when its commit is an ancestor of main."
//   2. "A missing or unreadable land record never turns a refusal into a
//      pass."
// Both are encoded in bl1898_land_record_close_guard_property_runner.bb,
// which drives the REAL ticket_close_guard_lib.bb over a real store with
// constructed near-miss tickets and asserts its own generator reach. This
// file puts it in the property lane.
//
// Non-vacuity: a loosened ticket match (case-folded substring) failed P1 79
// times; skipping the store's line check crashed the runner on the first
// corrupt line. Both restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(
  __dirname,
  '..',
  '..',
  'swarmforge',
  'scripts',
  'test',
  'bl1898_land_record_close_guard_property_runner.bb'
);

test('BL-1898/BL-654 invariants: a land record opens only its own ticket on main, and a bad store never passes', () => {
  const res = spawnSync('bb', [RUNNER], { encoding: 'utf8', timeout: 240000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  assert.equal(res.status, 0, out);
  assert.match(out, /ALL PASS: BL-1898 land record close guard properties/);
}, 300000);
