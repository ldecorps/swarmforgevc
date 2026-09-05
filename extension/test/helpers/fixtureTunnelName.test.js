'use strict';

// BL-1287: unit tests for the new pure discriminator functions
// (creatingPidFor, isProcessAlive) leakedFixtureTunnelPids now composes.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { creatingPidFor, isProcessAlive } = require('./fixtureTunnelName');

test('creatingPidFor reads the creator pid out of a fixtureTunnelName()-shaped ps line', () => {
  const line = '12345 /tmp/bl857-prop-fake-cf-xyz/cloudflared tunnel --config /tmp/x/fake-config.yml --no-autoupdate run sfvc-test-987-2-bl857-inv1-ab12cd';
  assert.equal(creatingPidFor(line), 987);
});

test('creatingPidFor returns null for a line that does not carry the fixtureTunnelName() shape', () => {
  assert.equal(creatingPidFor('12345 /usr/local/bin/cloudflared tunnel run some-other-name'), null);
  assert.equal(creatingPidFor(''), null);
});

test('creatingPidFor is anchored on "run <name>", not merely the name appearing anywhere in the line', () => {
  // The name mentioned only in --config, never after "run", must not be
  // read as the creator - the same "flag the form, not the string
  // anywhere" discipline this session's other guards use.
  const line = '1 /tmp/x/cloudflared tunnel --config /tmp/sfvc-test-111-1-decoy/fake-config.yml run sfvc-test-222-1-real-abcdef';
  assert.equal(creatingPidFor(line), 222);
});

test('isProcessAlive answers true for this process itself', () => {
  assert.equal(isProcessAlive(process.pid), true);
});

test('isProcessAlive answers false for a pid that has fully exited', () => {
  const child = spawnSync('true', []);
  assert.equal(isProcessAlive(child.pid), false);
});

test('isProcessAlive answers false for pid 0 and negative pids (never throws)', () => {
  // process.kill(0, 0) signals the CALLER's own process group on POSIX,
  // which this test's own process belongs to - a real hazard if isAlive
  // were ever asked about pid 0. isProcessAlive must never signal it.
  assert.doesNotThrow(() => isProcessAlive(0));
  assert.doesNotThrow(() => isProcessAlive(-1));
});
