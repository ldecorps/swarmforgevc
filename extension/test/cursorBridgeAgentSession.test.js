const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const MODULE_PATH = require.resolve('../out/bridge/cursorBridgeAgentSession');

function loadCursorBridgeAgentSessionFresh() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

let createMockCursorBridgeAgentSession;
let isAbandonedAgentLock;
let runCursorAgentPrompt;
let buildAgentOptions;
let withAgentLock;
let resolveCursorApiKey;

beforeEach(() => {
  ({
    createMockCursorBridgeAgentSession,
    isAbandonedAgentLock,
    runCursorAgentPrompt,
    buildAgentOptions,
    withAgentLock,
    resolveCursorApiKey,
  } = loadCursorBridgeAgentSessionFresh());
});

// BL-1050: runCursorAgentPrompt now records every run failure. These
// pre-existing cases care about the THROWN error, not the record, so they get
// a recording sink rather than printing a real failure line into the suite's
// stderr. The default stderr sink has its own test at the end of this file.
function quietLogDeps() {
  return { sink: () => {}, now: () => '2026-08-22T23:00:00.000Z', env: {} };
}

function mkRoot() {
  const root = mkTmpDir('sfvc-cursor-session-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function statePath(root) {
  return path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json');
}

function lockPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'cursor-bridge-agent.lock');
}

test('cursorBridgeAgentSession: fresh require loads tsc interop exports', () => {
  const mod = loadCursorBridgeAgentSessionFresh();
  assert.equal(typeof mod.withAgentLock, 'function');
  assert.equal(typeof mod.createMockCursorBridgeAgentSession, 'function');
  assert.equal(typeof mod.isAbandonedAgentLock, 'function');
  assert.equal(typeof mod.buildAgentOptions, 'function');
  assert.equal(typeof mod.runCursorAgentPrompt, 'function');
  assert.equal(typeof mod.createLiveCursorBridgeAgentSession, 'function');
});

test('cursorBridgeAgentSession: mock session remembers and recalls code words', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const first = await session.promptAgent('remember the code word GAMMA');
  assert.match(first.replyText, /GAMMA/);
  const second = await session.promptAgent('what was the code word');
  assert.match(second.replyText, /GAMMA/);
  assert.equal(first.agentId, second.agentId);
});

test('cursorBridgeAgentSession: resetSession clears remembered context', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  await session.promptAgent('remember the code word DELTA');
  const before = session.readAgentId();
  await session.resetSession();
  const after = await session.promptAgent('what was the code word');
  assert.notEqual(session.readAgentId(), before);
  assert.match(after.replyText, /do not have a code word/i);
});

test('cursorBridgeAgentSession: withAgentLock serializes concurrent holders', async () => {
  const root = mkRoot();
  let concurrent = 0;
  let maxConcurrent = 0;
  const hold = async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 30));
    concurrent -= 1;
  };
  await Promise.all([withAgentLock(root, hold), withAgentLock(root, hold)]);
  assert.equal(maxConcurrent, 1);
});

test('cursorBridgeAgentSession: withAgentLock waits for a contended lock to clear', async () => {
  const root = mkRoot();
  let releaseFirst;
  const firstHold = withAgentLock(root, async () => {
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const waitStarted = Date.now();
  const second = withAgentLock(root, async () => 'second');
  await new Promise((resolve) => setTimeout(resolve, 900));
  releaseFirst();
  assert.equal(await firstHold, undefined);
  assert.equal(await second, 'second');
  assert.ok(Date.now() - waitStarted >= 800);
}, 10000);

test('cursorBridgeAgentSession: withAgentLock uses strict less-than maxAttempts', async () => {
  vi.useFakeTimers();
  const ceilSpy = vi.spyOn(Math, 'ceil').mockReturnValue(2);
  const root = mkRoot();
  let releaseHold;
  const holding = withAgentLock(root, async () => {
    await new Promise((resolve) => {
      releaseHold = resolve;
    });
  });
  await Promise.resolve();
  let polls = 0;
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (handler, delay, ...args) => {
    if (delay === 25) {
      polls += 1;
    }
    return originalSetTimeout(handler, delay, ...args);
  };
  try {
    const pending = withAgentLock(root, async () => 'ok');
    const rejection = assert.rejects(pending, /cursor bridge agent lock timeout/);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    assert.equal(polls, 2);
  } finally {
    global.setTimeout = originalSetTimeout;
    ceilSpy.mockRestore();
    releaseHold();
    await holding;
    vi.useRealTimers();
  }
});

test('cursorBridgeAgentSession: acquireAgentLock computes maxAttempts with division', async () => {
  const ceilSpy = vi.spyOn(Math, 'ceil');
  try {
    const root = mkRoot();
    let releaseHold;
    const holding = withAgentLock(root, async () => {
      await new Promise((resolve) => {
        releaseHold = resolve;
      });
    });
    await Promise.resolve();
    const pending = withAgentLock(root, async () => 'ok');
    releaseHold();
    await pending;
    await holding;
    assert.ok(ceilSpy.mock.calls.some(([value]) => value === (10 * 60 * 1000) / 25));
  } finally {
    ceilSpy.mockRestore();
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock uses strict greater-than stale comparison', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  const fixedNow = Date.now();
  const originalNow = Date.now;
  const originalStat = fs.statSync;
  Date.now = () => fixedNow;
  fs.statSync = (target) => {
    const stat = originalStat(target);
    if (target === file) {
      return { ...stat, mtimeMs: fixedNow - 5 * 60 * 1000 };
    }
    return stat;
  };
  try {
    assert.equal(isAbandonedAgentLock(file), false);
  } finally {
    Date.now = originalNow;
    fs.statSync = originalStat;
  }
});

test('cursorBridgeAgentSession: loadState reads state files as utf8', async () => {
  const root = mkRoot();
  fs.writeFileSync(statePath(root), `${JSON.stringify({ updateOffset: 0 })}\n`, 'utf8');
  const originalRead = fs.readFileSync;
  let seenEncoding;
  fs.readFileSync = (filePath, encoding) => {
    if (String(filePath).endsWith('cursor-bridge-state.json')) {
      seenEncoding = encoding;
    }
    return originalRead(filePath, encoding);
  };
  try {
    const session = createMockCursorBridgeAgentSession(root);
    await session.promptAgent('hello');
    assert.equal(seenEncoding, 'utf8');
  } finally {
    fs.readFileSync = originalRead;
  }
});

test('cursorBridgeAgentSession: readLockHolderPid trims lock file contents', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, ' 999999999 \n');
  let trimmed = false;
  const originalTrim = String.prototype.trim;
  String.prototype.trim = function lockTrimSpy() {
    if (String(this).includes('999999999')) {
      trimmed = true;
    }
    return originalTrim.call(this);
  };
  try {
    assert.equal(isAbandonedAgentLock(file), true);
    assert.equal(trimmed, true);
  } finally {
    String.prototype.trim = originalTrim;
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock skips process.kill when pid is missing', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, 'abc\n');
  let killCalled = false;
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    killCalled = true;
    return originalKill.call(process, pid, signal);
  };
  try {
    assert.equal(isAbandonedAgentLock(file), true);
    assert.equal(killCalled, false);
  } finally {
    process.kill = originalKill;
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock clears locks from dead processes', () => {
  const root = mkRoot();
  const lockPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-agent.lock');
  fs.writeFileSync(lockPath, '999999999\n');
  assert.equal(isAbandonedAgentLock(lockPath), true);
});

test('cursorBridgeAgentSession: acquireAgentLock recovers an abandoned lock file', async () => {
  const root = mkRoot();
  const lockPath = path.join(root, '.swarmforge', 'operator', 'cursor-bridge-agent.lock');
  fs.writeFileSync(lockPath, '999999999\n');
  let acquired = false;
  await withAgentLock(root, async () => {
    acquired = true;
  });
  assert.equal(acquired, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('cursorBridgeAgentSession: buildAgentOptions includes model and local cwd', () => {
  const opts = buildAgentOptions('/repo', 'key-1', 'auto');
  assert.equal(opts.model.id, 'auto');
  assert.equal(opts.local.cwd, '/repo');
  assert.equal(opts.apiKey, 'key-1');
});

test('cursorBridgeAgentSession: runCursorAgentPrompt collects assistant text', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-1' };
        },
      };
    },
  };
  const text = await runCursorAgentPrompt(agent, 'ping');
  assert.equal(text, 'hello');
});

test('cursorBridgeAgentSession: runCursorAgentPrompt throws on error status', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } };
        },
        async wait() {
          return { status: 'error', id: 'run-err', error: { message: 'boom' } };
        },
      };
    },
  };
  await assert.rejects(() => runCursorAgentPrompt(agent, 'ping', undefined, quietLogDeps()), /boom/);
});

function mockSdkAgent(replyText = 'live reply') {
  return {
    agentId: 'agent-live-99',
    close: async () => {},
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: replyText }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-live' };
        },
      };
    },
  };
}

test('cursorBridgeAgentSession: live session prompts through SDK agent', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const originalResume = sdk.Agent.resume;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  sdk.Agent.create = async () => mockSdkAgent('remember the code word LIVE');
  sdk.Agent.resume = async () => mockSdkAgent('resumed');
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const first = await session.promptAgent('remember the code word LIVE');
    assert.match(first.replyText, /LIVE/);
    assert.equal(first.agentId, 'agent-live-99');
    const second = await session.resetSession();
    assert.equal(second.agentId, undefined);
  } finally {
    sdk.Agent.create = originalCreate;
    sdk.Agent.resume = originalResume;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session recovers when resumed agentId is gone', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const originalResume = sdk.Agent.resume;
  let creates = 0;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json'),
    `${JSON.stringify({ updateOffset: 0, agentId: 'agent-47f26e41-65e8-459a-96f0-4a6a8e7bbfb0' }, null, 2)}\n`,
    'utf8'
  );
  sdk.Agent.resume = async () => {
    throw new Error('Agent agent-47f26e41-65e8-459a-96f0-4a6a8e7bbfb0 not found.');
  };
  sdk.Agent.create = async () => {
    creates += 1;
    return mockSdkAgent('after gone-agent reset');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /after gone-agent reset/);
    assert.equal(creates, 1);
    assert.equal(session.readAgentId(), 'agent-live-99');
  } finally {
    sdk.Agent.create = originalCreate;
    sdk.Agent.resume = originalResume;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session recovers from authentication error', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const originalResume = sdk.Agent.resume;
  let creates = 0;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json'),
    `${JSON.stringify({ updateOffset: 0, agentId: 'stale-agent' }, null, 2)}\n`,
    'utf8'
  );
  sdk.Agent.resume = async () => {
    throw new Error('Authentication error If you are logged in, try logging out and back in.');
  };
  sdk.Agent.create = async () => {
    creates += 1;
    return mockSdkAgent('after auth reset');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /after auth reset/);
    assert.equal(creates, 1);
    assert.equal(session.readAgentId(), 'agent-live-99');
  } finally {
    sdk.Agent.create = originalCreate;
    sdk.Agent.resume = originalResume;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session recovers from active-run conflict', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  let calls = 0;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  sdk.Agent.create = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        agentId: 'agent-conflict',
        close: async () => {},
        async send() {
          throw new sdk.CursorAgentError('Agent agent-conflict already has active run');
        },
      };
    }
    return mockSdkAgent('after reset');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /after reset/);
    assert.ok(calls >= 2);
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: isAbandonedAgentLock treats stale mtime as abandoned', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  const staleMs = Date.now() - 6 * 60 * 1000;
  fs.utimesSync(file, new Date(staleMs), new Date(staleMs));
  assert.equal(isAbandonedAgentLock(file), true);
});

test('cursorBridgeAgentSession: isAbandonedAgentLock keeps a fresh lock inside the stale window', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  const twoMinAgo = Date.now() - 2 * 60 * 1000;
  fs.utimesSync(file, new Date(twoMinAgo), new Date(twoMinAgo));
  assert.equal(isAbandonedAgentLock(file), false);
});

test('cursorBridgeAgentSession: isAbandonedAgentLock treats nearly five minute old locks as fresh', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  const almostFiveMinAgo = Date.now() - (5 * 60 * 1000 - 250);
  fs.utimesSync(file, new Date(almostFiveMinAgo), new Date(almostFiveMinAgo));
  assert.equal(isAbandonedAgentLock(file), false);
});

test('cursorBridgeAgentSession: isAbandonedAgentLock keeps a live pid lock', () => {
  const root = mkRoot();
  const file = lockPath(root);
  fs.writeFileSync(file, `${process.pid}\n`);
  assert.equal(isAbandonedAgentLock(file), false);
});

// BL-1207: `  42  \n` used to sit in this table. readLockHolderPid trims
// BEFORE parsing (production is correct - the lock is written as
// `${process.pid}\n`), so a padded pid is well-formed, not malformed. On
// this host pid 42 belongs to a live, root-owned systemd-journal process,
// so the row's verdict was decided by whether that pid happened to be
// running - host-dependent, not the rejection behaviour it was filed
// under. Moved to the liveness scenario below (invariant 1); this table
// keeps only contents that are malformed on every host.
const MALFORMED_LOCK_CASES = [
  ['lock-zero.lock', '0\n'],
  ['lock-abc.lock', 'abc\n'],
  ['lock-empty.lock', '\n'],
  ['lock-null-padded.lock', '\u0000999999999\n'],
];

// BL-1207: a dead-process stand-in from a declared constant, never a small
// literal a real system process could hold - same reasoning as
// bl984FixtureSweep.property.test.js's DEAD_PID_BASE (99000000, "far
// beyond any real pid table: macOS pid_max ~99998, Linux ~4M default").
// Scenario 03 asserts this host actually cannot signal it, so the
// stand-in can never quietly become a real process the way pid 42 did.
const DEAD_PID = 99000001;

test('cursorBridgeAgentSession: isAbandonedAgentLock rejects malformed pid values without consulting any host process', () => {
  const root = mkRoot();
  let killCalls = 0;
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    killCalls += 1;
    return originalKill.call(process, pid, signal);
  };
  try {
    for (const [name, raw] of MALFORMED_LOCK_CASES) {
      const file = path.join(root, '.swarmforge', 'operator', name);
      fs.writeFileSync(file, raw);
      assert.equal(isAbandonedAgentLock(file), true, `expected abandoned for ${JSON.stringify(raw)}`);
    }
    assert.equal(killCalls, 0, 'expected no host process to be consulted for malformed contents');
  } finally {
    process.kill = originalKill;
  }
});

// BL-1207 invariant 2: the malformed-case table and this liveness scenario
// stay disjoint and jointly total - the padded-pid row that used to sit in
// the malformed table now lives here, exercising readLockHolderPid's trim
// branch via liveness alone rather than via a host-accidental rejection.
test('cursorBridgeAgentSession: isAbandonedAgentLock judges a padded pid by liveness alone, not by its padding', () => {
  const root = mkRoot();

  const ownFile = path.join(root, '.swarmforge', 'operator', 'lock-own-padded.lock');
  fs.writeFileSync(ownFile, `  ${process.pid}  \n`);
  assert.equal(isAbandonedAgentLock(ownFile), false, "expected the suite's own padded pid not abandoned");

  const deadFile = path.join(root, '.swarmforge', 'operator', 'lock-dead-padded.lock');
  fs.writeFileSync(deadFile, `  ${DEAD_PID}  \n`);
  assert.equal(isAbandonedAgentLock(deadFile), true, 'expected the declared unreachable padded pid abandoned');
});

test('cursorBridgeAgentSession: the declared unreachable pid is actually unreachable on this host', () => {
  let code;
  try {
    process.kill(DEAD_PID, 0);
    assert.fail(`expected process.kill(${DEAD_PID}, 0) to raise, it succeeded`);
  } catch (err) {
    code = err.code;
  }
  assert.notEqual(code, 'EPERM', `DEAD_PID=${DEAD_PID} is live but unsignalable on this host - pick a different constant`);
  assert.ok(code === 'ESRCH' || code === 'ERANGE', `expected ESRCH or ERANGE for DEAD_PID=${DEAD_PID}, got ${code}`);
});

// BL-1207 invariant 2 / constraint: keyed on the SAME structured list the
// verdict test above iterates, never a text grep - a prose grep would trip
// on this very test file explaining the offending value.
test('cursorBridgeAgentSession: no malformed case parses to a positive integer', () => {
  for (const [name, raw] of MALFORMED_LOCK_CASES) {
    const parsed = Number.parseInt(raw.trim(), 10);
    const isPositiveInt = Number.isFinite(parsed) && parsed > 0;
    assert.equal(isPositiveInt, false, `expected ${name} (${JSON.stringify(raw)}) not to parse to a positive integer, got ${parsed}`);
  }
});

// Non-vacuity for the guard above: a scratch case shaped exactly like the
// original defect (a small integer padded with spaces) must fail it.
test('cursorBridgeAgentSession: the malformed-case guard is non-vacuous', () => {
  const scratchCase = ['lock-scratch-regression.lock', '  42  \n'];
  const parsed = Number.parseInt(scratchCase[1].trim(), 10);
  const isPositiveInt = Number.isFinite(parsed) && parsed > 0;
  assert.equal(isPositiveInt, true, 'fixture precondition: the scratch case must itself be a well-formed pid to prove the guard is not vacuous');
});

test('cursorBridgeAgentSession: isAbandonedAgentLock treats EPERM from process.kill as a live holder', () => {
  const root = mkRoot();
  const file = lockPath(root);
  const targetPid = 424242;
  fs.writeFileSync(file, `${targetPid}\n`);
  const originalKill = process.kill;
  process.kill = (pid, signal) => {
    if (pid === targetPid) {
      const err = new Error('operation not permitted');
      err.code = 'EPERM';
      throw err;
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    assert.equal(isAbandonedAgentLock(file), false);
  } finally {
    process.kill = originalKill;
  }
});

test('cursorBridgeAgentSession: buildAgentOptions omits apiKey and keeps empty settingSources', () => {
  const opts = buildAgentOptions('/repo', undefined, 'auto');
  assert.equal('apiKey' in opts, false);
  assert.deepEqual(opts.local.settingSources, []);
  assert.equal(opts.local.cwd, '/repo');
});

test('cursorBridgeAgentSession: runCursorAgentPrompt returns placeholder for empty assistant stream', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {},
        async wait() {
          return { status: 'success', id: 'run-empty' };
        },
      };
    },
  };
  assert.equal(await runCursorAgentPrompt(agent, 'ping'), '(no text reply)');
});

test('cursorBridgeAgentSession: runCursorAgentPrompt throws unknown error when message missing', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {},
        async wait() {
          return { status: 'error', id: 'run-err', error: {} };
        },
      };
    },
  };
  await assert.rejects(() => runCursorAgentPrompt(agent, 'ping', undefined, quietLogDeps()), /unknown error/);
});

test('cursorBridgeAgentSession: runCursorAgentPrompt handles missing error object via optional chaining', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {},
        async wait() {
          return { status: 'error', id: 'run-err' };
        },
      };
    },
  };
  await assert.rejects(() => runCursorAgentPrompt(agent, 'ping', undefined, quietLogDeps()), /unknown error/);
});

test('cursorBridgeAgentSession: runCursorAgentPrompt forwards only streamed messages to collector', async () => {
  const core = require('../out/tools/telegramCursorBridgeCore');
  const originalCollect = core.collectAssistantTextFromMessages;
  let captured;
  core.collectAssistantTextFromMessages = (messages) => {
    captured = messages;
    return originalCollect(messages);
  };
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-1' };
        },
      };
    },
  };
  try {
    assert.equal(await runCursorAgentPrompt(agent, 'ping'), 'hello');
    assert.equal(captured.length, 1);
  } finally {
    core.collectAssistantTextFromMessages = originalCollect;
  }
});

test('cursorBridgeAgentSession: runCursorAgentPrompt trims assistant whitespace', async () => {
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: '  padded  ' }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-trim' };
        },
      };
    },
  };
  assert.equal(await runCursorAgentPrompt(agent, 'ping'), 'padded');
});

test('cursorBridgeAgentSession: mock session exposes rememberedCodeWord helper', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  assert.equal(session.readAgentId(), 'mock-agent-1');
  assert.equal(session.rememberedCodeWord(), undefined);
  await session.promptAgent('remember the code word ZETA');
  assert.equal(session.rememberedCodeWord(), 'ZETA');
});

test('cursorBridgeAgentSession: mock session ignores prompts without a code word token', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  await session.promptAgent('remember the code word ZETA');
  await session.promptAgent('remember the code word ');
  assert.equal(session.rememberedCodeWord(), 'ZETA');
  const recall = await session.promptAgent('what was the code word');
  assert.match(recall.replyText, /ZETA/);
});

test('cursorBridgeAgentSession: mock session leaves rememberedCodeWord unset for ordinary prompts', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  await session.promptAgent('just chatting');
  assert.equal(session.rememberedCodeWord(), undefined);
});

test('cursorBridgeAgentSession: mock resetSession returns agentId and persists state', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const reset = await session.resetSession();
  assert.ok(Object.hasOwn(reset, 'agentId'));
  assert.match(reset.agentId, /^mock-agent-/);
  const persisted = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  assert.equal(persisted.agentId, reset.agentId);
  assert.equal(persisted.updateOffset, 0);
});

test('cursorBridgeAgentSession: mock promptAgent persists agentId under operator state path', async () => {
  const root = mkRoot();
  const session = createMockCursorBridgeAgentSession(root);
  const reply = await session.promptAgent('hello');
  const persisted = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  assert.equal(persisted.agentId, reply.agentId);
  assert.equal(persisted.updateOffset, 0);
  assert.equal(session.readAgentId(), reply.agentId);
});

test('cursorBridgeAgentSession: live session resumes agentId from persisted state', async () => {
  const root = mkRoot();
  fs.writeFileSync(statePath(root), `${JSON.stringify({ updateOffset: 3, agentId: 'existing-agent' }, null, 2)}\n`);
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const originalResume = sdk.Agent.resume;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let resumedId;
  sdk.Agent.create = async () => {
    throw new Error('create must not run when state carries agentId');
  };
  sdk.Agent.resume = async (agentId, opts) => {
    resumedId = agentId;
    assert.equal(opts.model.id, 'auto');
    return mockSdkAgent('resumed reply');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.equal(resumedId, 'existing-agent');
    assert.match(reply.replyText, /resumed reply/);
    assert.equal(session.readAgentId(), 'agent-live-99');
    assert.equal(JSON.parse(fs.readFileSync(statePath(root), 'utf8')).updateOffset, 3);
  } finally {
    sdk.Agent.create = originalCreate;
    sdk.Agent.resume = originalResume;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session honors CURSOR_BRIDGE_MODEL override', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const prevModel = process.env.CURSOR_BRIDGE_MODEL;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  process.env.CURSOR_BRIDGE_MODEL = 'custom-model';
  let capturedModel;
  sdk.Agent.create = async (opts) => {
    capturedModel = opts.model.id;
    return mockSdkAgent('model check');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await session.promptAgent('ping');
    assert.equal(capturedModel, 'custom-model');
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevModel === undefined) delete process.env.CURSOR_BRIDGE_MODEL;
    else process.env.CURSOR_BRIDGE_MODEL = prevModel;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session reuses cached agent across prompts', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let creates = 0;
  sdk.Agent.create = async () => {
    creates += 1;
    return mockSdkAgent('cached');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await session.promptAgent('one');
    await session.promptAgent('two');
    assert.equal(creates, 1);
    assert.equal(session.readAgentId(), 'agent-live-99');
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session propagates non-conflict agent errors without recovery', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let creates = 0;
  sdk.Agent.create = async () => {
    creates += 1;
    return {
      agentId: 'agent-fail',
      close: async () => {},
      async send() {
        throw new Error('quota exceeded');
      },
    };
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await assert.rejects(() => session.promptAgent('ping'), /quota exceeded/);
    assert.equal(creates, 1);
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live session recovers active-run conflict from plain Error', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  let calls = 0;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  sdk.Agent.create = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        agentId: 'agent-plain-conflict',
        close: async () => {},
        async send() {
          throw new Error('Agent agent-plain-conflict already has active run');
        },
      };
    }
    return mockSdkAgent('plain recovery');
  };
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const reply = await session.promptAgent('ping');
    assert.match(reply.replyText, /plain recovery/);
    assert.ok(calls >= 2);
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: live resetSession clears persisted agentId', async () => {
  const root = mkRoot();
  const sdk = require('@cursor/sdk');
  const originalCreate = sdk.Agent.create;
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  sdk.Agent.create = async () => mockSdkAgent('persist me');
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await session.resetSession();
    await session.promptAgent('ping');
    assert.equal(JSON.parse(fs.readFileSync(statePath(root), 'utf8')).agentId, 'agent-live-99');
    const reset = await session.resetSession();
    assert.ok(Object.hasOwn(reset, 'agentId'));
    assert.equal(reset.agentId, undefined);
    assert.equal(session.readAgentId(), undefined);
    const persisted = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
    assert.equal(persisted.agentId, undefined);
    assert.equal(persisted.updateOffset, 0);
  } finally {
    sdk.Agent.create = originalCreate;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('cursorBridgeAgentSession: loadState reads utf8 state files with non-ascii agent ids', async () => {
  const root = mkRoot();
  const raw = `${JSON.stringify({ updateOffset: 7, agentId: 'mock-☃' }, null, 2)}\n`;
  fs.writeFileSync(statePath(root), raw, 'utf8');
  assert.equal(fs.readFileSync(statePath(root), 'utf8'), raw);
  const session = createMockCursorBridgeAgentSession(root);
  await session.promptAgent('hello');
  const persisted = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  assert.equal(persisted.updateOffset, 7);
  assert.equal(persisted.agentId, session.readAgentId());
});

test('cursorBridgeAgentSession: resolveCursorApiKey reads swarm.env when process env is empty', () => {
  const root = mkRoot();
  const envPath = path.join(root, '.swarmforge', 'swarm.env');
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, 'export CURSOR_API_KEY="key-from-swarm-env"\n', 'utf8');
  const prev = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    assert.equal(resolveCursorApiKey(root), 'key-from-swarm-env');
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
});

test('cursorBridgeAgentSession: resolveCursorApiKey fails with actionable message when missing everywhere', () => {
  const root = mkRoot();
  const prev = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    assert.throws(() => resolveCursorApiKey(root), /CURSOR_API_KEY is not set/);
    assert.throws(() => resolveCursorApiKey(root), /swarm\.env/);
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
});

// ── BL-1322: constructing a live session must not eagerly require the key ──

test('BL-1322: createLiveCursorBridgeAgentSession does not throw when CURSOR_API_KEY is unset', () => {
  const root = mkRoot();
  const prevKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    assert.doesNotThrow(() => createLiveCursorBridgeAgentSession(root));
  } finally {
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('BL-1322: readAgentId works with no CURSOR_API_KEY set', () => {
  const root = mkRoot();
  const prevKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    assert.doesNotThrow(() => session.readAgentId());
  } finally {
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('BL-1322: resetSession works with no CURSOR_API_KEY set', async () => {
  const root = mkRoot();
  const prevKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    const result = await session.resetSession();
    assert.equal(result.agentId, undefined);
  } finally {
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

test('BL-1322: promptAgent still fails with the documented message when CURSOR_API_KEY is unset', async () => {
  const root = mkRoot();
  const prevKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    const { createLiveCursorBridgeAgentSession } = loadCursorBridgeAgentSessionFresh();
    const session = createLiveCursorBridgeAgentSession(root);
    await assert.rejects(() => session.promptAgent('ping'), /CURSOR_API_KEY is not set for the headless bridge/);
  } finally {
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});

// ── BL-1050: a failed run is recorded on this host, not only in Telegram ──

function failingAgent(status, id, message) {
  return {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } };
        },
        async wait() {
          return { status, id, error: message === undefined ? undefined : { message } };
        },
      };
    },
  };
}

function recordingLogDeps(env = {}) {
  const lines = [];
  return { lines, deps: { sink: (l) => lines.push(l), now: () => '2026-08-22T23:00:00.000Z', env } };
}

test('BL-1050: a failed run is logged before the error the Telegram poster catches', async () => {
  const { lines, deps } = recordingLogDeps();
  const agent = failingAgent('error', 'run-err', 'Connection failed repeatedly');
  await assert.rejects(() => runCursorAgentPrompt(agent, 'ping', undefined, deps), /Connection failed repeatedly/);
  assert.equal(lines.length, 1, 'the failure must be recorded exactly once');
  assert.match(lines[0], /cursor-bridge run failed/);
  assert.match(lines[0], /run=run-err/);
  assert.match(lines[0], /reason=Connection failed repeatedly/);
});

test('BL-1050: the logged reset decision follows shouldResetCursorAgentSession', async () => {
  const reset = recordingLogDeps();
  await assert.rejects(
    () => runCursorAgentPrompt(failingAgent('error', 'r1', 'Connection failed repeatedly'), 'ping', undefined, reset.deps),
    /Connection failed/
  );
  assert.match(reset.lines[0], /reset=yes/);

  const notReset = recordingLogDeps();
  await assert.rejects(
    () => runCursorAgentPrompt(failingAgent('error', 'r2', 'resource_exhausted'), 'ping', undefined, notReset.deps),
    /quota exhausted/
  );
  assert.match(notReset.lines[0], /reset=no/);
});

test('BL-1050: a quota failure is logged with the SDK reason, not the rewritten human message', async () => {
  const { lines, deps } = recordingLogDeps();
  await assert.rejects(
    () => runCursorAgentPrompt(failingAgent('error', 'r3', 'resource_exhausted'), 'ping', undefined, deps),
    /quota exhausted/
  );
  assert.match(lines[0], /reason=resource_exhausted/);
});

test('BL-1050: the thrown message a human sees is unchanged by the logging', async () => {
  const { deps } = recordingLogDeps();
  await assert.rejects(
    () => runCursorAgentPrompt(failingAgent('error', 'run-err', 'boom'), 'ping', undefined, deps),
    /^Error: Cursor run failed \(run-err\): boom$/
  );
});

test('BL-1050: no log line text reaches the progress callback the topic renders', async () => {
  const { lines, deps } = recordingLogDeps();
  const progress = [];
  await assert.rejects(
    () => runCursorAgentPrompt(failingAgent('error', 'run-err', 'boom'), 'ping', (l) => progress.push(l), deps),
    /boom/
  );
  assert.equal(lines.length, 1);
  for (const line of progress) {
    assert.ok(!line.includes('cursor-bridge run failed'), `a log line reached the topic: ${line}`);
  }
});

test('BL-1050: a secret in the SDK reason never reaches the log', async () => {
  const { lines, deps } = recordingLogDeps({ CURSOR_API_KEY: 'sk-cursor-abcdefgh' });
  await assert.rejects(
    () => runCursorAgentPrompt(failingAgent('error', 'r', 'auth rejected sk-cursor-abcdefgh'), 'ping', undefined, deps),
    /auth rejected/
  );
  assert.ok(!lines[0].includes('sk-cursor-abcdefgh'), "the CURSOR_API_KEY value reached cursor-bridge.log");
  assert.match(lines[0], /\[redacted\]/);
});

test('BL-1050: the prompt text never reaches the log', async () => {
  const { lines, deps } = recordingLogDeps();
  await assert.rejects(
    () => runCursorAgentPrompt(failingAgent('error', 'r', 'boom'), 'deploy the staging key', undefined, deps),
    /boom/
  );
  assert.ok(!lines[0].includes('deploy the staging key'));
});

test('BL-1050: a successful run logs nothing at all', async () => {
  const { lines, deps } = recordingLogDeps();
  const agent = {
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-ok' };
        },
      };
    },
  };
  assert.equal(await runCursorAgentPrompt(agent, 'ping', undefined, deps), 'hello');
  assert.deepEqual(lines, []);
});

test('BL-1050: a log sink that throws does not replace the run failure the caller reports', async () => {
  const deps = {
    sink: () => {
      throw new Error('log device full');
    },
    now: () => '2026-08-22T23:00:00.000Z',
    env: {},
  };
  await assert.rejects(
    () => runCursorAgentPrompt(failingAgent('error', 'run-err', 'boom'), 'ping', undefined, deps),
    /Cursor run failed \(run-err\): boom/
  );
});

test('BL-1050: the default deps print the failure line to stderr, which the supervisor redirects', async () => {
  const { defaultCursorRunLogDeps } = require('../out/bridge/cursorBridgeRunLog');
  const deps = defaultCursorRunLogDeps();
  const printed = [];
  const originalError = console.error;
  console.error = (line) => printed.push(line);
  try {
    deps.sink('a line');
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(printed, ['a line']);
  assert.equal(deps.env, process.env);
  assert.match(deps.now(), /^\d{4}-\d{2}-\d{2}T/);
});

// ── BL-1050 (architect send-back #1): a failing post must not abort the run ─

function progressEventAgent(status, id, message) {
  return {
    async send() {
      return {
        async *stream() {
          // A tool_call renders to a progress line; an assistant event does
          // not, which is how a "failing post" test can be silently inert.
          yield { type: 'tool_call', name: 'shell', status: 'running' };
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } };
        },
        async wait() {
          return { status, id, error: message === undefined ? undefined : { message } };
        },
      };
    },
  };
}

test('BL-1050: a progress post that throws still lets the run failure reach the log', async () => {
  const lines = [];
  let attempts = 0;
  await assert.rejects(
    () =>
      runCursorAgentPrompt(
        progressEventAgent('error', 'run-err', 'Connection failed repeatedly'),
        'ping',
        () => {
          attempts++;
          throw new Error('telegram post failed');
        },
        { sink: (l) => lines.push(l), now: () => '2026-08-22T23:00:00.000Z', env: {} }
      ),
    /Connection failed repeatedly/
  );
  assert.ok(attempts > 0, 'the post must actually have been attempted');
  assert.equal(lines.filter((l) => l.includes('cursor-bridge run failed')).length, 1);
  assert.equal(lines.filter((l) => l.includes('cursor-bridge progress post failed')).length, 1);
});

test('BL-1050: a progress post that throws does not fail an otherwise healthy run', async () => {
  const lines = [];
  const text = await runCursorAgentPrompt(
    progressEventAgent('success', 'run-ok', undefined),
    'ping',
    () => {
      throw new Error('telegram post failed');
    },
    { sink: (l) => lines.push(l), now: () => '2026-08-22T23:00:00.000Z', env: {} }
  );
  assert.equal(text, 'hello');
  assert.deepEqual(lines.filter((l) => l.includes('cursor-bridge run failed')), []);
  assert.equal(lines.filter((l) => l.includes('cursor-bridge progress post failed')).length, 1);
});

test('BL-1050: a healthy post is still delivered, so the guard is not a blanket swallow', async () => {
  const posted = [];
  await runCursorAgentPrompt(
    progressEventAgent('success', 'run-ok', undefined),
    'ping',
    (line) => posted.push(line),
    quietLogDeps()
  );
  assert.ok(posted.length > 0, 'progress must still reach the topic when posting works');
});
