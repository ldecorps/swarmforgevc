'use strict';

// BL-1851 declared invariants (property authorship rests with the coder,
// first pass - BL-654). Thin Vitest wrapper over the Babashka property
// runner that encodes both invariants against the real
// local_seat_tuning_report_cli.bb: the report is read-only (a directory
// snapshot before/after is byte-identical), and every metric a record
// does not carry prints as unknown, never as a literal 0.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { propertyLaneTimeoutMs } = require('./helpers/propertyLaneContentionBudget');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl1851_seat_tuning_report_property_runner.bb'
);

test(
  'BL-1851/BL-654: the tuning report is read-only and never prints 0 for an unrecorded field (bb property runner)',
  () => {
    const r = spawnSync('bb', [RUNNER], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PROPERTY_RUNS: process.env.PROPERTY_RUNS || '15',
      },
      timeout: 60000,
    });
    assert.equal(
      r.status,
      0,
      `bl1851 property runner failed:\n${r.stdout || ''}${r.stderr || ''}`
    );
  },
  propertyLaneTimeoutMs(20000)
);
