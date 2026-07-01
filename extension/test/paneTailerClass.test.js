const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { PaneTailer, STALL_THRESHOLD_MS } = require('../out/panel/paneTailer');
const { installFakeTmux } = require('./helpers/fakeTmux');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-panetailer-'));
}

function writeState(targetPath, roleLines = '1\tcoder\tswarmforge-coder\tCoder\tclaude\n') {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), path.join(targetPath, 'fake.sock'));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), roleLines);
}

function waitUntil(predicate, timeoutMs = 2000, intervalMs = 10) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('waitUntil timed out'));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

test('refreshState reads roles and socket path from target state', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();
    assert.equal(tailer.getRoles().length, 1);
    assert.equal(tailer.getRoles()[0].role, 'coder');
  } finally {
    fake.restore();
  }
});

test('start/poll reports pane output for a live session, stop halts further polling', async () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'agent output' },
    { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
    { exitCode: 0, stdout: '' },
  ]);
  try {
    const updates = [];
    const tailer = new PaneTailer(targetPath, (u) => updates.push(...u));
    tailer.start(15);
    await waitUntil(() => updates.length > 0);
    assert.equal(updates[0].role, 'coder');
    assert.match(updates[0].text, /agent output/);

    tailer.stop();
    const countAfterStop = updates.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(updates.length, countAfterStop, 'no further polls should fire after stop()');
  } finally {
    fake.restore();
  }
});

test('poll reports a dead session and fires onDead once, then revives it', async () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ subcommand: 'has-session', exitCode: 1 }]);
  try {
    const updates = [];
    const deadEvents = [];
    const tailer = new PaneTailer(targetPath, (u) => updates.push(...u), undefined, (e) => deadEvents.push(...e));
    // start(huge pollMs) runs refreshState() + one poll() synchronously and
    // never lets the interval fire before stop(); further poll()s are driven
    // directly so refreshState() doesn't reset dead/live tracking in between.
    tailer.start(1_000_000);
    tailer.stop();

    assert.equal(updates.length, 1);
    assert.match(updates[0].text, /is not running/);
    // liveRoles was never populated (session was dead from the start), so no dead event yet.
    assert.equal(deadEvents.length, 0);

    fake.setRules([{ subcommand: 'has-session', exitCode: 0 }, { exitCode: 0, stdout: '' }]);
    tailer.poll();
    // now goes live: liveRoles gets populated, no prior dead flag to clear
    assert.equal(deadEvents.length, 0);

    fake.setRules([{ subcommand: 'has-session', exitCode: 1 }]);
    tailer.poll();
    assert.equal(deadEvents.length, 1);
    assert.deepEqual(deadEvents[0], { role: 'coder', dead: true });

    fake.setRules([{ subcommand: 'has-session', exitCode: 0 }, { exitCode: 0, stdout: '' }]);
    tailer.poll();
    assert.equal(deadEvents.length, 2);
    assert.deepEqual(deadEvents[1], { role: 'coder', dead: false });
  } finally {
    fake.restore();
  }
});

test('poll reports a capture failure with a readable-pane error message', async () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 1 },
    { exitCode: 0, stdout: '' },
  ]);
  try {
    const updates = [];
    const tailer = new PaneTailer(targetPath, (u) => updates.push(...u));
    tailer.start(1_000_000);
    tailer.stop();
    assert.equal(updates.length, 1);
    assert.match(updates[0].text, /Could not read tmux pane/);
  } finally {
    fake.restore();
  }
});

test('poll notifies onRoles when a role is added between polls', async () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 0, stdout: '' },
    { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
    { exitCode: 0, stdout: '' },
  ]);
  try {
    const roleUpdates = [];
    const tailer = new PaneTailer(
      targetPath,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      (roles) => roleUpdates.push(roles)
    );
    tailer.start(1_000_000);
    tailer.stop();
    assert.equal(roleUpdates.length, 0, 'role set unchanged after refreshState + first poll');

    writeState(
      targetPath,
      '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tQA\tswarmforge-QA\tQA\tclaude\n'
    );
    tailer.poll();
    assert.equal(roleUpdates.length, 1);
    assert.equal(roleUpdates[0].length, 2);
  } finally {
    fake.restore();
  }
});

test('forwardInput no-ops for an unknown role', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();
    tailer.forwardInput('unknown-role', 'x');
    const sendKeyCalls = fake.calls().filter((args) => args.includes('send-keys'));
    assert.equal(sendKeyCalls.length, 0);
  } finally {
    fake.restore();
  }
});

test('forwardInput sends mapped keys to tmux and logs the keystroke', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();
    tailer.forwardInput('coder', 'hello');
    const sendKeyCall = fake.calls().find((args) => args.includes('send-keys'));
    assert.ok(sendKeyCall);
    assert.ok(sendKeyCall.includes('-l'));
    assert.ok(sendKeyCall.includes('hello'));

    const logPath = path.join(targetPath, '.swarmforge', 'input-log.jsonl');
    const logged = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(logged.length, 1);
    assert.equal(logged[0].role, 'coder');
    assert.equal(logged[0].data, 'hello');
  } finally {
    fake.restore();
  }
});

test('forwardSpecialKey sends the mapped tmux key name for a known key', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();
    tailer.forwardSpecialKey('coder', 'ArrowUp');
    const sendKeyCall = fake.calls().find((args) => args.includes('send-keys'));
    assert.ok(sendKeyCall);
    assert.ok(sendKeyCall.includes('Up'));
  } finally {
    fake.restore();
  }
});

test('forwardSpecialKey no-ops for an unmapped key', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();
    tailer.forwardSpecialKey('coder', 'NotAKey');
    const sendKeyCalls = fake.calls().filter((args) => args.includes('send-keys'));
    assert.equal(sendKeyCalls.length, 0);
  } finally {
    fake.restore();
  }
});

// Note: onInputLogError cannot currently be exercised. appendInputEntry
// (src/swarm/inputLog.ts) swallows its own filesystem errors internally, so
// the catch block in PaneTailer.logInput that reports through
// onInputLogError is unreachable as written. Flagged for the pipeline;
// hardening does not change product behavior to make it reachable.
test('a failed input-log write does not throw and keystroke delivery continues', () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([{ exitCode: 0, stdout: '' }]);
  try {
    const tailer = new PaneTailer(targetPath, () => {});
    tailer.refreshState();

    const stateDir = path.join(targetPath, '.swarmforge');
    fs.chmodSync(stateDir, 0o555);
    try {
      assert.doesNotThrow(() => tailer.forwardInput('coder', 'x'));
      const sendKeyCall = fake.calls().find((args) => args.includes('send-keys'));
      assert.ok(sendKeyCall, 'keystroke is still forwarded even though logging failed');
    } finally {
      fs.chmodSync(stateDir, 0o755);
    }
  } finally {
    fake.restore();
  }
});

test('onStall fires stalled then unstalled as pane output ages and then changes', async () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
    { exitCode: 0, stdout: '' },
  ]);
  const realDateNow = Date.now;
  let mockedNow = realDateNow();
  Date.now = () => mockedNow;
  try {
    const stallEvents = [];
    let captureOutput = 'first output';
    const tailer = new PaneTailer(
      targetPath,
      () => {},
      (events) => stallEvents.push(...events)
    );
    // capture-pane rule needs to be dynamic per-poll; drive it via setRules before each start()/stop() pair.
    fake.setRules([
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 0, stdout: captureOutput },
      { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
      { exitCode: 0, stdout: '' },
    ]);
    // start(huge pollMs) runs refreshState() + one poll() synchronously; every
    // subsequent step drives poll() directly so refreshState() doesn't reset
    // lastChangedAt/stalledRoles in between.
    tailer.start(1_000_000);
    tailer.stop();
    assert.equal(stallEvents.length, 0);

    mockedNow += STALL_THRESHOLD_MS + 1;
    tailer.poll();
    assert.equal(stallEvents.length, 1);
    assert.deepEqual(stallEvents[0], { role: 'coder', stalled: true });

    mockedNow += 1;
    captureOutput = 'second output';
    fake.setRules([
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 0, stdout: captureOutput },
      { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
      { exitCode: 0, stdout: '' },
    ]);
    tailer.poll();
    assert.equal(stallEvents.length, 2);
    assert.deepEqual(stallEvents[1], { role: 'coder', stalled: false });
  } finally {
    Date.now = realDateNow;
    fake.restore();
  }
});

test('onNeedsHuman fires true when a pane shows a question, then false once it resumes, with no duplicate events', async () => {
  const targetPath = mkTmp();
  writeState(targetPath);
  const fake = installFakeTmux([
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
    { exitCode: 0, stdout: '' },
  ]);
  try {
    const needsHumanEvents = [];
    const tailer = new PaneTailer(
      targetPath,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (events) => needsHumanEvents.push(...events)
    );

    fake.setRules([
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 0, stdout: 'working on it...' },
      { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
      { exitCode: 0, stdout: '' },
    ]);
    tailer.start(1_000_000);
    tailer.stop();
    assert.equal(needsHumanEvents.length, 0, 'plain output must not fire needsHuman');

    fake.setRules([
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 0, stdout: 'Continue? (y/n)' },
      { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
      { exitCode: 0, stdout: '' },
    ]);
    tailer.poll();
    assert.equal(needsHumanEvents.length, 1);
    assert.deepEqual(needsHumanEvents[0], { role: 'coder', needsHuman: true });

    // Text unchanged (same question still on screen) must not refire the event.
    tailer.poll();
    assert.equal(needsHumanEvents.length, 1, 'unchanged needs-human state must not refire');

    fake.setRules([
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 0, stdout: 'resumed working' },
      { subcommand: 'display-message', exitCode: 0, stdout: 'claude' },
      { exitCode: 0, stdout: '' },
    ]);
    tailer.poll();
    assert.equal(needsHumanEvents.length, 2);
    assert.deepEqual(needsHumanEvents[1], { role: 'coder', needsHuman: false });
  } finally {
    fake.restore();
  }
});
