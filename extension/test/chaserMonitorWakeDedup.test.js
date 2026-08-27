'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { withHandoffWakeDedupCallbacks } = require('../out/watchdog/chaserMonitor');
const { readWakeDedupSidecar } = require('../out/swarm/wakeDedup');

function seedCoordinatorMailbox(root) {
  const inboxNew = path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new');
  fs.mkdirSync(inboxNew, { recursive: true });
  fs.writeFileSync(path.join(inboxNew, '00_test.handoff'), 'ticket: BL-1191\n');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coordinator\tmaster\t${root}\t\tCoordinator\tclaude\n`
  );
}

describe('chaserMonitor wake dedup (BL-1191)', () => {
  it('withHandoffWakeDedupCallbacks suppresses duplicate wakes', () => {
    const root = mkTmpDir('chaser-wake-dedup-');
    seedCoordinatorMailbox(root);

    let wakeCalls = 0;
    const inner = { sendWakeUp: () => { wakeCalls += 1; } };
    const wrapped = withHandoffWakeDedupCallbacks(root, inner);

    wrapped.sendWakeUp('coordinator');
    assert.equal(wakeCalls, 1);
    const afterFirst = readWakeDedupSidecar(root, 'coordinator');
    assert.ok(afterFirst?.fingerprint);

    wrapped.sendWakeUp('coordinator');
    assert.equal(wakeCalls, 1, 'second wake for unchanged mailbox must be suppressed');
  });
});
