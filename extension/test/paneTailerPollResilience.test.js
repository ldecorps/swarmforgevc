const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// BL-088: a per-tick exception thrown before onOutput silently froze every
// tile while the rest of the extension host stayed alive (no crash, no
// stalled/dead marker, just a stale frame forever). These tests drive the
// REAL PaneTailer.poll() through a forced fault on the accumulation path
// (patched below, before paneTailer.js is first required so its own
// destructured import picks up the patched function) and assert the tailer
// keeps producing updates for unaffected roles and self-heals once the
// fault clears.

const paneHistory = require('../out/panel/paneHistory');
const originalAccumulate = paneHistory.accumulatePaneHistory;

let faultRawText = null;
paneHistory.accumulatePaneHistory = (previousContentLines, history, rawCaptureText, maxHistoryLines) => {
  if (faultRawText !== null && rawCaptureText.includes(faultRawText)) {
    throw new Error('simulated poll-tick failure');
  }
  return originalAccumulate(previousContentLines, history, rawCaptureText, maxHistoryLines);
};

const { PaneTailer } = require('../out/panel/paneTailer');
const { installFakeTmux } = require('./helpers/fakeTmux');

test.after(() => {
  paneHistory.accumulatePaneHistory = originalAccumulate;
});

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-panetailer-poll-resilience-'));
}

function writeState(targetPath, roleLines) {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), path.join(targetPath, 'fake.sock'));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), roleLines);
}

// Two roles share one fake tmux, so capture-pane must be routed per target.
function twoRoleCaptureRule(coderStdout, qaStdout) {
  return [
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', argsInclude: 'swarmforge-coder', exitCode: 0, stdout: coderStdout },
    { subcommand: 'capture-pane', argsInclude: 'swarmforge-qa', exitCode: 0, stdout: qaStdout },
    { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
    { exitCode: 0, stdout: '' },
  ];
}

// BL-088 tile-freeze-02: one failing poll tick does not kill the tailer
test('BL-088: a poll-tick failure for one role does not block onOutput for sibling roles', () => {
  const targetPath = mkTmp();
  writeState(targetPath, '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tqa\tswarmforge-qa\tQA\tclaude\n');
  faultRawText = null;
  const fake = installFakeTmux(twoRoleCaptureRule('coder tick0\n❯ ', 'qa tick0\n❯ '));
  try {
    const updates = [];
    const errors = [];
    const tailer = new PaneTailer(
      targetPath,
      (u) => updates.push(...u),
      undefined,
      undefined,
      undefined,
      500,
      undefined,
      undefined,
      undefined,
      (message) => errors.push(message)
    );
    tailer.start(1_000_000);
    tailer.stop();

    // Make the coder role's own capture explode on the NEXT poll, while QA's
    // capture changes normally.
    faultRawText = 'coder tick1';
    fake.setRules(twoRoleCaptureRule('coder tick1\n❯ ', 'qa tick1\n❯ '));
    tailer.poll();

    const qaUpdate = updates.find((u) => u.role === 'qa' && u.text.includes('qa tick1'));
    assert.ok(qaUpdate, 'qa must still receive its update even though coder blew up this tick');
    assert.ok(
      errors.some((m) => m.includes('coder')),
      'the failure must be reported, not silently swallowed'
    );

    // Next tick, the fault clears — coder must resume updating too.
    faultRawText = null;
    fake.setRules(twoRoleCaptureRule('coder tick2\n❯ ', 'qa tick2\n❯ '));
    tailer.poll();

    const coderUpdate = updates.find((u) => u.role === 'coder' && u.text.includes('coder tick2'));
    assert.ok(coderUpdate, 'coder must resume updating on the next successful poll, not stay frozen forever');
  } finally {
    faultRawText = null;
    fake.restore();
  }
});

// BL-088 tile-freeze-02: a persistently-failing role must not stop the whole
// tailer — it must keep retrying every tick, not latch shut permanently.
test('BL-088: a role that keeps failing every tick still lets other roles update on every subsequent poll', () => {
  const targetPath = mkTmp();
  writeState(targetPath, '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tqa\tswarmforge-qa\tQA\tclaude\n');
  faultRawText = null;
  const fake = installFakeTmux(twoRoleCaptureRule('coder tick0\n❯ ', 'qa tick0\n❯ '));
  try {
    const updates = [];
    const tailer = new PaneTailer(targetPath, (u) => updates.push(...u), undefined, undefined, undefined, 500);
    tailer.start(1_000_000);
    tailer.stop();

    faultRawText = 'coder';
    for (let n = 1; n <= 5; n++) {
      fake.setRules(twoRoleCaptureRule(`coder tick${n}\n❯ `, `qa tick${n}\n❯ `));
      tailer.poll();
    }

    const qaUpdates = updates.filter((u) => u.role === 'qa');
    // start() fires one initial poll (tick0) plus the 5 explicit polls above.
    assert.equal(qaUpdates.length, 6, 'qa must receive an update on every one of the 6 polls despite coder failing every tick');
  } finally {
    faultRawText = null;
    fake.restore();
  }
});

// BL-088 tile-freeze-03: unchanged captures never latch the tailer shut
test('BL-088: several identical polls in a row do not prevent the next real change from being pushed', () => {
  const targetPath = mkTmp();
  writeState(targetPath, '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
  faultRawText = null;
  const steady = [
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'steady output\n❯ ' },
    { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
    { exitCode: 0, stdout: '' },
  ];
  const fake = installFakeTmux(steady);
  try {
    const updates = [];
    const tailer = new PaneTailer(targetPath, (u) => updates.push(...u), undefined, undefined, undefined, 500);
    tailer.start(1_000_000);
    tailer.stop();
    const afterFirst = updates.length;

    for (let i = 0; i < 10; i++) {
      tailer.poll();
    }
    assert.equal(updates.length, afterFirst, 'identical captures must not push further updates');

    fake.setRules([
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 0, stdout: 'changed output\n❯ ' },
      { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
      { exitCode: 0, stdout: '' },
    ]);
    tailer.poll();

    const latest = updates[updates.length - 1];
    assert.ok(latest.text.includes('changed output'), 'a genuine change after a long steady run must still be pushed');
  } finally {
    fake.restore();
  }
});
