const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { reconcileOnce, writeOnboarderHeartbeat, main, pollLoop } = require('../out/tools/onboarder-reconcile');

async function withEnv(vars, fn) {
  const originals = {};
  for (const key of Object.keys(vars)) originals[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function mkTmpRoot() {
  return mkTmpDir('sfvc-onboarding-reconcile-');
}

function heartbeatPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'onboarder-heartbeat.json');
}

function topicMapPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');
}

function readTopicMapFixture(root) {
  return JSON.parse(fs.readFileSync(topicMapPath(root), 'utf8'));
}

function fakeCreateOk(threadId) {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: threadId, name: 'Onboarding' } } };
  };
  return { postFn, calls };
}

test('BL-590: writeOnboarderHeartbeat writes the shared {lastHeartbeatMs} shape', () => {
  const root = mkTmpRoot();
  writeOnboarderHeartbeat(root, () => 12345);
  assert.deepEqual(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')), { lastHeartbeatMs: 12345 });
});

test('BL-590: reconcileOnce ensures the Onboarding topic and writes a heartbeat in one call', async () => {
  const root = mkTmpRoot();
  const { postFn, calls } = fakeCreateOk(42);
  const topicId = await reconcileOnce(root, 'fake-token', 'fake-chat', postFn, () => 999);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 1);
  assert.equal(readTopicMapFixture(root)['42'], 'ONBOARDING');
  assert.deepEqual(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')), { lastHeartbeatMs: 999 });
});

test('BL-590: reconcileOnce reuses an already-bound topic without creating another, still refreshing the heartbeat', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify({ '42': 'ONBOARDING' }));
  const { postFn, calls } = fakeCreateOk(999);
  const topicId = await reconcileOnce(root, 'fake-token', 'fake-chat', postFn, () => 555);
  assert.equal(topicId, 42);
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')), { lastHeartbeatMs: 555 });
});

test('BL-590: main() reconcile-once mode succeeds with valid env vars', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify({ '42': 'ONBOARDING' }));
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  const originalLog = console.log;
  const logs = [];
  console.log = (msg) => logs.push(msg);
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = 'test-chat';
    // Pre-existing topic map allows reconcileOnce to succeed without calling Telegram
    await main([root, 'reconcile-once']);
    assert(logs.length > 0);
    assert(logs[0].includes('ok'));
  } finally {
    console.log = originalLog;
    if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalChatId !== undefined) process.env.TELEGRAM_CHAT_ID = originalChatId;
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    if (originalChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
  }
});

test('BL-590: main() requires TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID and a valid mode, never crashes with a raw stack trace', async () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  const originalExit = process.exit;
  const originalError = console.error;
  const exits = [];
  const errors = [];
  process.exit = (code) => {
    exits.push(code);
    throw new Error('__exit__');
  };
  console.error = (msg) => errors.push(msg);
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    await assert.rejects(() => main(['/tmp/whatever', 'bogus-mode']), /__exit__/);
    assert.deepEqual(exits, [1]);
    assert.deepEqual(errors, ['Usage: onboarder-reconcile.js <targetPath> reconcile-once|poll-loop']);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalChatId !== undefined) process.env.TELEGRAM_CHAT_ID = originalChatId;
  }
});

// ── BL-684 hardening pass: main()'s own env/argv wiring and its exact
// {ok, topicId} report were exercised only by tests that happened not to
// distinguish the real branch from a gutted one (mutation survivors, not a
// behavior change - the postFn seam added to handleReconcileMode/main
// mirrors the seam reconcileOnce/ensureOnboardingTopic already had) ───────

test('BL-590: main() throws requireEnv\'s specific message when TELEGRAM_BOT_TOKEN is missing, even with a valid mode', async () => {
  await withEnv({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: 'test-chat' }, async () => {
    await assert.rejects(() => main(['/tmp/whatever', 'reconcile-once']), /onboarder-reconcile: TELEGRAM_BOT_TOKEN is required/);
  });
});

test('BL-590: main() throws requireEnv\'s specific message when TELEGRAM_CHAT_ID is missing, even with a valid mode', async () => {
  await withEnv({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: undefined }, async () => {
    await assert.rejects(() => main(['/tmp/whatever', 'reconcile-once']), /onboarder-reconcile: TELEGRAM_CHAT_ID is required/);
  });
});

test('BL-590: main() reconcile-once mode reports exactly {ok:true, topicId} on success', async () => {
  const root = mkTmpRoot();
  fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
  fs.writeFileSync(topicMapPath(root), JSON.stringify({ '42': 'ONBOARDING' }));
  const originalLog = console.log;
  const logs = [];
  console.log = (msg) => logs.push(msg);
  try {
    await withEnv({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' }, async () => {
      await main([root, 'reconcile-once']);
    });
    assert.equal(logs.length, 1);
    assert.deepEqual(JSON.parse(logs[0]), { ok: true, topicId: 42 });
  } finally {
    console.log = originalLog;
  }
});

test('BL-590: main() reconcile-once mode reports exactly {ok:false} (no topicId) and exits 1 when the topic cannot be ensured', async () => {
  const root = mkTmpRoot();
  const failingPostFn = async () => ({ ok: false, status: 500, json: { description: 'boom' } });
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalStderrWrite = process.stderr.write;
  const logs = [];
  const exits = [];
  process.exit = (code) => {
    exits.push(code);
    throw new Error('__exit__');
  };
  console.log = (msg) => logs.push(msg);
  process.stderr.write = () => true; // suppress ensureOnboardingTopic's own diagnostic write
  try {
    await withEnv({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' }, async () => {
      await assert.rejects(() => main([root, 'reconcile-once'], failingPostFn), /__exit__/);
    });
    assert.equal(logs.length, 1);
    assert.deepEqual(JSON.parse(logs[0]), { ok: false });
    assert.deepEqual(exits, [1]);
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    process.stderr.write = originalStderrWrite;
  }
});

test('BL-590: main()\'s default argv is process.argv.slice(2), not the raw process.argv (which still carries the node binary and script path)', async () => {
  const originalArgv = process.argv;
  const originalError = console.error;
  const errors = [];
  console.error = (msg) => errors.push(msg);
  try {
    // Sliced correctly: ['/tmp/whatever', 'reconcile-once'] - a valid
    // invocation that proceeds past argv validation to requireEnv.
    // Unsliced (the mutant): [targetPath, mode] would destructure to the
    // node binary and script path instead, which are never a valid mode -
    // and would wrongly hit the "Usage:" error path.
    process.argv = ['/usr/bin/node', '/path/to/onboarder-reconcile.js', '/tmp/whatever', 'reconcile-once'];
    await withEnv({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }, async () => {
      await assert.rejects(() => main(), /onboarder-reconcile: TELEGRAM_BOT_TOKEN is required/);
    });
    assert.deepEqual(errors, []);
  } finally {
    process.argv = originalArgv;
    console.error = originalError;
  }
});

test('BL-590: pollLoop reconciles repeatedly at the configured interval, driven entirely by fake timers (never a real wait)', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(1_700_000_000_000);
    const root = mkTmpRoot();
    fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
    fs.writeFileSync(topicMapPath(root), JSON.stringify({ '42': 'ONBOARDING' }));
    // Intentionally not awaited: pollLoop runs forever by design (a daemon
    // loop) - fake timers drive it forward without ever really waiting.
    pollLoop(root, 'fake-token', 'fake-chat');
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')).lastHeartbeatMs, 1_700_000_000_000);

    await vi.advanceTimersByTimeAsync(60_000); // RECONCILE_INTERVAL_MS
    assert.equal(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')).lastHeartbeatMs, 1_700_000_060_000);
  } finally {
    vi.useRealTimers();
  }
});

test('BL-590: main() with mode "poll-loop" actually starts polling forever, never falling through to the one-shot reconcile-once path', async () => {
  vi.useFakeTimers();
  const originalLog = console.log;
  const logs = [];
  console.log = (msg) => logs.push(msg);
  try {
    vi.setSystemTime(1_700_000_000_000);
    const root = mkTmpRoot();
    fs.mkdirSync(path.dirname(topicMapPath(root)), { recursive: true });
    fs.writeFileSync(topicMapPath(root), JSON.stringify({ '42': 'ONBOARDING' }));
    await withEnv({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' }, async () => {
      main([root, 'poll-loop']); // intentionally not awaited - runs forever
      await vi.advanceTimersByTimeAsync(0);
    });
    assert.equal(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')).lastHeartbeatMs, 1_700_000_000_000);
    // handleReconcileMode (the reconcile-once path) is the ONLY thing in this
    // module that ever calls console.log - if the poll-loop branch fell
    // through to it instead of genuinely looping, this would be non-empty.
    assert.deepEqual(logs, []);

    // A second interval must produce a SECOND heartbeat write - proof this is
    // an actual loop, not a one-shot call that happens to write one heartbeat.
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(JSON.parse(fs.readFileSync(heartbeatPath(root), 'utf8')).lastHeartbeatMs, 1_700_000_060_000);
    assert.deepEqual(logs, []);
  } finally {
    console.log = originalLog;
    vi.useRealTimers();
  }
});

test('BL-590: main() treats "poll-loop" as a valid mode, never routing it through the argv-usage error', async () => {
  const originalError = console.error;
  const errors = [];
  console.error = (msg) => errors.push(msg);
  try {
    await withEnv({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }, async () => {
      // Fails later, at requireEnv - proves argv validation accepted "poll-loop"
      // as legitimate rather than bouncing it to the "Usage:" error path.
      await assert.rejects(() => main(['/tmp/whatever', 'poll-loop']), /onboarder-reconcile: TELEGRAM_BOT_TOKEN is required/);
    });
    assert.deepEqual(errors, []);
  } finally {
    console.error = originalError;
  }
});
