'use strict';

// BL-1114 declared invariants (coder first authorship — BL-654):
//
// 1. Every new *.handoff.dead is either announced with a recorded reason, or
//    the notify sweep records a named refusal — never a silent no-op.
// 2. When recovery attempts reach the configured max, a needs-human (or
//    equivalent) escalation is raised and the owning role is not left with
//    only silent debris.
//
// Non-vacuity: exhausted recovery always wakes the holder and clears
// inbox/new of the .dead.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  recoverDeadLettersForRole,
  writeRecoveryAttempts,
  decideRecoveryAction,
} = require('../out/swarm/handoffRecovery');

const CFG = { maxRecoveryAttempts: 3 };

function writeDead(inboxNewDir, name) {
  fs.mkdirSync(inboxNewDir, { recursive: true });
  const filePath = path.join(inboxNewDir, name);
  fs.writeFileSync(filePath, 'type: note\nrecipient: coder\ntask: BL-1114-prop\n\nbody\n');
  return filePath;
}

test('BL-1114: exhausted recovery never leaves silent .dead debris in inbox/new', () => {
  fc.assert(
    fc.property(fc.integer({ min: CFG.maxRecoveryAttempts, max: 12 }), (attempts) => {
      const root = mkTmpDir('bl1114-prop-');
      const inboxNew = path.join(root, 'inbox', 'new');
      const dead = writeDead(inboxNew, '00_prop.handoff.dead');
      writeRecoveryAttempts(dead, attempts);

      const wakes = [];
      const escalations = [];
      const outcomes = recoverDeadLettersForRole('coder', inboxNew, CFG, {
        isRecipientBusy: () => false,
        sendWakeUp: (role) => wakes.push(role),
        logRemediation: () => {},
        setNeedsHuman: (role, needsHuman) => escalations.push({ role, needsHuman }),
      });

      assert.equal(decideRecoveryAction(attempts, false, CFG), 'escalated');
      assert.equal(outcomes[0]?.action, 'escalated');
      assert.deepEqual(wakes, ['coder']);
      assert.deepEqual(escalations, [{ role: 'coder', needsHuman: true }]);
      assert.equal(fs.existsSync(dead), false);
      assert.equal(fs.existsSync(path.join(root, 'failed', '00_prop.handoff.dead')), true);
      const notes = fs.readdirSync(inboxNew).filter((f) => f.endsWith('.handoff'));
      assert.equal(notes.length, 1);
    }),
    { numRuns: 20 }
  );
});
