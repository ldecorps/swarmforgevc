const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const {
  sampleWorkerChildrenOnce,
  runProfilingSession,
  buildProfilingReport,
  listChildPidsReal,
  readNumberFlag,
  DEFAULT_RESERVE_MB,
  main,
} = require('../out/tools/profile-mutation-workers');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'profile-mutation-workers.js');

// ── sampleWorkerChildrenOnce (pure given injected adapters) ────────────────

test('sampleWorkerChildrenOnce samples every child pid returned by listChildPids', () => {
  const adapters = {
    listChildPids: () => [11, 22],
    getStats: (pid) => ({ rssBytes: pid * 100, cpuPercent: 1 }),
  };
  const samples = sampleWorkerChildrenOnce(999, 5000, adapters);
  assert.deepEqual(samples, [
    { workerId: '11', rssBytes: 1100, atMs: 5000 },
    { workerId: '22', rssBytes: 2200, atMs: 5000 },
  ]);
});

test('sampleWorkerChildrenOnce skips a child whose stats could not be read, never fabricating a zero sample', () => {
  const adapters = {
    listChildPids: () => [11, 22],
    getStats: (pid) => (pid === 11 ? null : { rssBytes: 500, cpuPercent: 1 }),
  };
  const samples = sampleWorkerChildrenOnce(999, 1, adapters);
  assert.deepEqual(samples, [{ workerId: '22', rssBytes: 500, atMs: 1 }]);
});

test('sampleWorkerChildrenOnce with no children returns no samples', () => {
  const adapters = { listChildPids: () => [], getStats: () => ({ rssBytes: 1, cpuPercent: 1 }) };
  assert.deepEqual(sampleWorkerChildrenOnce(999, 1, adapters), []);
});

// ── runProfilingSession (fake spawn + fake scheduler, no real process/timer) ──

function fakeAdapters() {
  let exitCb = null;
  let tickFn = null;
  let clearedHandle = null;
  return {
    adapters: {
      spawnTarget: () => ({
        pid: 4242,
        onExit: (cb) => {
          exitCb = cb;
        },
      }),
      listChildPids: () => [11],
      getStats: () => ({ rssBytes: 777, cpuPercent: 1 }),
      scheduleTick: (fn) => {
        tickFn = fn;
        return 'timer-handle';
      },
      clearTick: (handle) => {
        clearedHandle = handle;
      },
      now: () => 12345,
    },
    fireTick: () => tickFn(),
    fireExit: (code) => exitCb(code),
    clearedHandle: () => clearedHandle,
  };
}

test('runProfilingSession accumulates one sample batch per fired tick', async () => {
  const { adapters, fireTick, fireExit } = fakeAdapters();
  const resultPromise = runProfilingSession('fake-cmd', [], 1000, adapters);
  fireTick();
  fireTick();
  fireExit(0);
  const result = await resultPromise;
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.samples, [
    { workerId: '11', rssBytes: 777, atMs: 12345 },
    { workerId: '11', rssBytes: 777, atMs: 12345 },
  ]);
});

test('runProfilingSession clears its tick timer on target exit, never leaking it', async () => {
  const { adapters, fireExit, clearedHandle } = fakeAdapters();
  const resultPromise = runProfilingSession('fake-cmd', [], 1000, adapters);
  fireExit(1);
  await resultPromise;
  assert.equal(clearedHandle(), 'timer-handle');
});

test('runProfilingSession with no ticks fired before exit returns zero samples, not an error', async () => {
  const { adapters, fireExit } = fakeAdapters();
  const resultPromise = runProfilingSession('fake-cmd', [], 1000, adapters);
  fireExit(0);
  const result = await resultPromise;
  assert.deepEqual(result.samples, []);
});

// ── buildProfilingReport (pure: samples -> peaks + recommendation) ─────────

const MB = 1024 * 1024;

test('buildProfilingReport reports each worker\'s peak and a concurrency recommendation from the WORST-CASE (max) peak', () => {
  const samples = [
    { workerId: 'a', rssBytes: 2000 * MB, atMs: 1 },
    { workerId: 'a', rssBytes: 3000 * MB, atMs: 2 },
    { workerId: 'b', rssBytes: 4000 * MB, atMs: 1 },
  ];
  const report = buildProfilingReport(samples, { freeRamBytes: 13000 * MB, coreCount: 20, reserveBytes: 1000 * MB });
  assert.deepEqual(report.perWorkerPeakRssBytes, { a: 3000 * MB, b: 4000 * MB });
  assert.equal(report.maxPeakRssBytes, 4000 * MB);
  // (13000-1000)/4000 = 3
  assert.equal(report.recommendedConcurrency, 3);
});

test('buildProfilingReport with no samples reports null peaks/recommendation, never a fabricated zero', () => {
  const report = buildProfilingReport([], { freeRamBytes: 13000 * MB, coreCount: 20, reserveBytes: 1000 * MB });
  assert.deepEqual(report.perWorkerPeakRssBytes, {});
  assert.equal(report.maxPeakRssBytes, null);
  assert.equal(report.recommendedConcurrency, null);
});

test('DEFAULT_RESERVE_MB is a positive, finite headroom margin', () => {
  assert.ok(Number.isFinite(DEFAULT_RESERVE_MB));
  assert.ok(DEFAULT_RESERVE_MB > 0);
});

// ── readNumberFlag (pure argv parsing) ──────────────────────────────────────

test('readNumberFlag reads the value following a present flag', () => {
  assert.equal(readNumberFlag(['--interval-ms', '250'], '--interval-ms', 999), 250);
});

test('readNumberFlag falls back when the flag is absent', () => {
  assert.equal(readNumberFlag([], '--interval-ms', 999), 999);
});

test('readNumberFlag falls back when the flag is the last argument with no value', () => {
  assert.equal(readNumberFlag(['--interval-ms'], '--interval-ms', 999), 999);
});

test('readNumberFlag falls back when the following value is not a number', () => {
  assert.equal(readNumberFlag(['--interval-ms', 'soon'], '--interval-ms', 999), 999);
});

// ── listChildPidsReal (thin OS adapter) ─────────────────────────────────────

test('listChildPidsReal finds a real spawned child of the current process', () => {
  const child = childProcess.spawn('sleep', ['0.5']);
  try {
    const pids = listChildPidsReal(process.pid);
    assert.ok(pids.includes(child.pid), `expected ${child.pid} among children, got ${JSON.stringify(pids)}`);
  } finally {
    child.kill();
  }
});

test('listChildPidsReal returns an empty list for a pid with no children', () => {
  assert.deepEqual(listChildPidsReal(999999), []);
});

// ── main() - real-but-trivial subprocess wiring, in-process (thin-wrapper rule) ──
// Mirrors queueStatusCli.test.js's seam: stub argv/cwd, call the real main()
// in-process so coverage/mutation can see its branches; the spawned target
// here is an instantly-exiting real process (never Stryker itself - a real
// mutation run is a QA/human-run measurement, not a unit test), so this
// stays fast and never waits on real wall-clock beyond one process exit.
async function runCli(args) {
  const previousArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', 'profile-mutation-workers.js', ...args];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
  }
  return writes.join('');
}

test('main() spawns the target command, waits for it to exit, and prints a JSON report', async () => {
  const output = await runCli(['--', 'node', '-e', 'process.exit(0)']);
  const report = JSON.parse(output);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.perWorkerPeakRssBytes, {});
});

test('main() with no target command prints usage and sets exit code 1, never silently spawning nothing', async () => {
  process.exitCode = undefined;
  try {
    await runCli([]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = undefined;
  }
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const output = childProcess.execFileSync('node', [CLI_PATH, '--', 'node', '-e', 'process.exit(0)'], { encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.perWorkerPeakRssBytes, {});
});
