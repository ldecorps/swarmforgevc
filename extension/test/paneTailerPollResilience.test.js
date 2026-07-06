const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

const tmuxClient = require('../out/swarm/tmuxClient');
const originalReadSwarmRoles = tmuxClient.readSwarmRoles;

let faultRolesRead = false;
tmuxClient.readSwarmRoles = (targetPath) => {
  if (faultRolesRead) {
    throw new Error('simulated state-file race');
  }
  return originalReadSwarmRoles(targetPath);
};

// BL-124/BL-125: in-process tmux capture double. The prior helper installed a
// fake `tmux` executable on PATH, so every PaneTailer.poll() spawned a node
// subprocess (has-session + capture-pane + display-message); under load that
// timed out. We patch the spawn-backed tmuxClient functions on the module
// object (PaneTailer calls them as tmuxClient_1.fn(...), so this intercepts)
// and route capture output per role target via a shared mutable.
const capture = { coder: '', qa: '' };
const originals = {
  capturePane: tmuxClient.capturePane,
  sessionExists: tmuxClient.sessionExists,
  getPaneCommand: tmuxClient.getPaneCommand,
  getPaneBaseIndex: tmuxClient.getPaneBaseIndex,
  resizeWindow: tmuxClient.resizeWindow,
  setHistoryLimit: tmuxClient.setHistoryLimit,
  setWindowSizeManual: tmuxClient.setWindowSizeManual,
  sendKeys: tmuxClient.sendKeys,
};
tmuxClient.capturePane = (_sock, target) => ({
  stdout: String(target).includes('swarmforge-qa') ? capture.qa : capture.coder,
  exitCode: 0,
  stderr: '',
});
tmuxClient.sessionExists = () => true;
tmuxClient.getPaneCommand = () => 'claude';
tmuxClient.getPaneBaseIndex = () => 0;
tmuxClient.resizeWindow = () => {};
tmuxClient.setHistoryLimit = () => {};
tmuxClient.setWindowSizeManual = () => {};
tmuxClient.sendKeys = () => ({ exitCode: 0, stdout: '', stderr: '' });

function setWindows(coder, qa) {
  capture.coder = coder;
  capture.qa = qa;
}

const { PaneTailer } = require('../out/panel/paneTailer');

afterAll(() => {
  paneHistory.accumulatePaneHistory = originalAccumulate;
  tmuxClient.readSwarmRoles = originalReadSwarmRoles;
  Object.assign(tmuxClient, originals);
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

// BL-088 tile-freeze-02: one failing poll tick does not kill the tailer
test('BL-088: a poll-tick failure for one role does not block onOutput for sibling roles', () => {
  const targetPath = mkTmp();
  writeState(targetPath, '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tqa\tswarmforge-qa\tQA\tclaude\n');
  faultRawText = null;
  setWindows('coder tick0\n❯ ', 'qa tick0\n❯ ');

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
  setWindows('coder tick1\n❯ ', 'qa tick1\n❯ ');
  tailer.poll();

  const qaUpdate = updates.find((u) => u.role === 'qa' && u.text.includes('qa tick1'));
  assert.ok(qaUpdate, 'qa must still receive its update even though coder blew up this tick');
  assert.ok(
    errors.some((m) => m.includes('coder')),
    'the failure must be reported, not silently swallowed'
  );

  // Next tick, the fault clears — coder must resume updating too.
  faultRawText = null;
  setWindows('coder tick2\n❯ ', 'qa tick2\n❯ ');
  tailer.poll();

  const coderUpdate = updates.find((u) => u.role === 'coder' && u.text.includes('coder tick2'));
  assert.ok(coderUpdate, 'coder must resume updating on the next successful poll, not stay frozen forever');
});

// BL-088 tile-freeze-02: a persistently-failing role must not stop the whole
// tailer — it must keep retrying every tick, not latch shut permanently.
test('BL-088: a role that keeps failing every tick still lets other roles update on every subsequent poll', () => {
  const targetPath = mkTmp();
  writeState(targetPath, '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tqa\tswarmforge-qa\tQA\tclaude\n');
  faultRawText = null;
  setWindows('coder tick0\n❯ ', 'qa tick0\n❯ ');

  const updates = [];
  const tailer = new PaneTailer(targetPath, (u) => updates.push(...u), undefined, undefined, undefined, 500);
  tailer.start(1_000_000);
  tailer.stop();

  faultRawText = 'coder';
  for (let n = 1; n <= 5; n++) {
    setWindows(`coder tick${n}\n❯ `, `qa tick${n}\n❯ `);
    tailer.poll();
  }

  const qaUpdates = updates.filter((u) => u.role === 'qa');
  // start() fires one initial poll (tick0) plus the 5 explicit polls above.
  assert.equal(qaUpdates.length, 6, 'qa must receive an update on every one of the 6 polls despite coder failing every tick');
});

// BL-088 tile-freeze-03: unchanged captures never latch the tailer shut
test('BL-088: several identical polls in a row do not prevent the next real change from being pushed', () => {
  const targetPath = mkTmp();
  writeState(targetPath, '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
  faultRawText = null;
  setWindows('steady output\n❯ ', '');

  const updates = [];
  const tailer = new PaneTailer(targetPath, (u) => updates.push(...u), undefined, undefined, undefined, 500);
  tailer.start(1_000_000);
  tailer.stop();
  const afterFirst = updates.length;

  for (let i = 0; i < 10; i++) {
    tailer.poll();
  }
  assert.equal(updates.length, afterFirst, 'identical captures must not push further updates');

  setWindows('changed output\n❯ ', '');
  tailer.poll();

  const latest = updates[updates.length - 1];
  assert.ok(latest.text.includes('changed output'), 'a genuine change after a long steady run must still be pushed');
});

// BL-088 tile-freeze-02: a fault in the role/socket refresh step itself (not
// just per-role capture) must be reported and must not stop per-role
// polling that tick.
test('BL-088: a refreshRolesForTick failure (state-file race) is reported and does not block per-role polling', () => {
  const targetPath = mkTmp();
  writeState(targetPath, '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
  faultRawText = null;
  faultRolesRead = false;
  setWindows('tick0\n❯ ', '');

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

  faultRolesRead = true;
  setWindows('tick1\n❯ ', '');
  tailer.poll();

  assert.ok(
    errors.some((m) => m.includes('Poll failed') && !m.includes('for ')),
    'a refreshRolesForTick fault must be reported (no per-role prefix, since it precedes the per-role loop)'
  );
  const coderUpdate = updates.find((u) => u.role === 'coder' && u.text.includes('tick1'));
  assert.ok(coderUpdate, 'the per-role capture loop must still run this tick despite the refresh step faulting');
  faultRolesRead = false;
});

// BL-088: poll() must return early (skip the per-role loop entirely) when
// there is still no tmux socket. Roles are populated (sessions.tsv exists)
// but tmux-socket does not, so a version that skipped the early return would
// still enter the per-role loop and visibly try (and fail) to poll them -
// this is the only way to observe the guard's effect, since an empty roles
// list would make both the early-return and no-early-return paths look the
// same from the outside.
test('BL-088: poll() with no socket path never enters the per-role loop, even with known roles', () => {
  const targetPath = mkTmp();
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), '1\tcoder\tswarmforge-coder\tCoder\tclaude\n');
  faultRawText = null;
  faultRolesRead = false;
  const updates = [];
  const deadEvents = [];
  const errors = [];
  const tailer = new PaneTailer(
    targetPath,
    (u) => updates.push(...u),
    undefined,
    (d) => deadEvents.push(...d),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (message) => errors.push(message)
  );
  tailer.poll();

  assert.equal(updates.length, 0, 'no socket means nothing to capture yet, even though a role is known');
  assert.equal(deadEvents.length, 0);
  assert.equal(errors.length, 0, 'the per-role loop must never run at all, so it cannot even fail');
});
