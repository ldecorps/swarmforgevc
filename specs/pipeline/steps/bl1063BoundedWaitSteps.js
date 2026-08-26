'use strict';

// BL-1063: step handlers for "an assertion about a backgrounded child waits
// for that child".
//
// Two defects in one property, so two kinds of scenario. 01-03 are about the
// WAIT: start_handoff_daemon.sh backgrounds the daemon and returns
// immediately, so reading its marker on the next line races the child. 04-06
// are about the ASSERTION: it was named for resolvability and asserted origin,
// which on any host with a system node is the branch operator_path_lib.sh is
// REQUIRED not to take.
//
// Everything here drives the real helper and the real scripts. Scenario 06
// says "the property file is run"; running vitest inside the acceptance runner
// would nest two test frameworks, so it drives the same launcher, the same
// lib and the same check invariant 1 drives - the substance of the run,
// without the nesting.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const START_SCRIPT = path.join(SCRIPTS, 'start_handoff_daemon.sh');
const { waitForFileSync, DEFAULT_TIMEOUT_MS } = require(path.join(
  REPO_ROOT,
  'extension',
  'test',
  'helpers',
  'waitForFileSync.js'
));

const FEATURE = 'BL-1063 an assertion about a backgrounded child waits for that child';

// Short enough that a scenario proving the deadline does not cost ten seconds,
// long enough that a healthy child is never cut off on a loaded host.
const SCENARIO_TIMEOUT_MS = 2000;

const tmpDirs = [];
let nodelessCache = null;
let callerNodeCache = null;
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function cleanup() {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
  // Both farms are created through mkTmp, so this sweep deletes them too - the
  // caches must go with them, or the next scenario points at a path that no
  // longer exists and the launcher fails for a reason that has nothing to do
  // with the scenario.
  nodelessCache = null;
  callerNodeCache = null;
}

function makeFakeNvmHome() {
  const home = mkTmp('bl1063-home-');
  for (const v of ['v9.11.2', 'v22.1.0']) {
    const binDir = path.join(home, '.nvm', 'versions', 'node', v, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(binDir, 'node'), 0o755);
  }
  return home;
}

// A real search path with every ordinary command EXCEPT node, so node
// genuinely does not resolve. Symlinking the real path rather than curating a
// list: a curated list goes stale silently, and its failure looks nothing like
// the thing under test.
function nodelessPath() {
  if (nodelessCache) return nodelessCache;
  const dir = mkTmp('bl1063-nodeless-');
  const seen = new Set();
  for (const src of ['/usr/bin', '/bin']) {
    let entries = [];
    try {
      entries = fs.readdirSync(src);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node' || name === 'nodejs' || seen.has(name)) continue;
      seen.add(name);
      try {
        fs.symlinkSync(path.join(src, name), path.join(dir, name));
      } catch {
        /* duplicate or unreadable - neither matters */
      }
    }
  }
  const probe = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8', env: { PATH: dir } });
  assert.notEqual(probe.status, 0, 'the node-less PATH still resolves node - the scenario would be vacuous');
  nodelessCache = dir;
  return dir;
}

// BL-1063 (architect bounce D1): the mirror of the farm above.
//
// The first pass wrote `/usr/bin:/bin` for every "caller resolves node" row,
// as though that literal deterministically carries node. Whether it does is a
// HOST FACT - and binding a host fact into an assertion about resolvability is
// this ticket's own defect, which the first pass reintroduced inverted. On a
// host with no system node, scenario 04's "resolves" row failed outright
// (verified by the architect by routing it through the node-less farm).
//
// The caller's node is now a stub we PLACE, on top of the node-less farm so
// every other command still resolves. Assertions compare against that known
// path, so there is nothing left to assume and no premise left to check.
function callerNodePath() {
  if (callerNodeCache) return callerNodeCache;
  const dir = mkTmp('bl1063-callernode-');
  const stub = path.join(dir, 'node');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(stub, 0o755);
  const callerPath = `${dir}:${nodelessPath()}`;
  const probe = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8', env: { PATH: callerPath } });
  assert.equal(probe.stdout.trim(), stub, 'the caller-resolves farm must resolve node to its own stub');
  callerNodeCache = { callerPath, stub };
  return callerNodeCache;
}

function killPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    if (pid) process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

// Launches the REAL start_handoff_daemon.sh with a stub daemon that records
// what bb and node resolved to. `writesMarker: false` gives a child that runs
// and claims its pid but never reports - which is what a bounded wait has to
// survive.
function launchDaemon({ callerPath, writesMarker = true }) {
  const root = mkTmp('bl1063-root-');
  const daemonDir = path.join(root, '.swarmforge', 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  const home = makeFakeNvmHome();
  const fakeBbDir = path.join(root, 'fake-bb');
  const stub = path.join(fakeBbDir, 'bb');
  const marker = path.join(root, 'resolved.log');
  fs.mkdirSync(fakeBbDir, { recursive: true });
  fs.writeFileSync(
    stub,
    [
      '#!/bin/sh',
      'script="$1"',
      'root="$2"',
      'daemon_dir="$root/.swarmforge/daemon"',
      'case "$script" in',
      '  *supervisor*) echo $$ > "$daemon_dir/handoffd-supervisor.pid" ;;',
      '  *)',
      writesMarker
        ? `    { command -v bb; command -v node; } > "${marker}" 2>&1 || true`
        : '    true',
      '    echo $$ > "$daemon_dir/handoffd.pid"',
      '    ;;',
      'esac',
      'sleep 3',
      '',
    ].join('\n')
  );
  fs.chmodSync(stub, 0o755);

  const result = spawnSync('bash', [START_SCRIPT, root], {
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: `${fakeBbDir}:${callerPath}`,
      HOME: home,
      HANDOFFD_BB: path.join(root, 'fake-handoffd.bb'),
      HANDOFFD_SUPERVISOR_BB: path.join(root, 'fake-handoffd-supervisor.bb'),
    },
  });
  return {
    root,
    home,
    marker,
    stub,
    result,
    nvmTree: path.join(home, '.nvm', 'versions', 'node'),
    kill: () => {
      killPid(path.join(daemonDir, 'handoffd.pid'));
      killPid(path.join(daemonDir, 'handoffd-supervisor.pid'));
    },
  };
}

function waitForMarker(launch, timeoutMs) {
  return waitForFileSync(launch.marker, {
    timeoutMs,
    ready: (text) => text.trim().split('\n').filter(Boolean).length === 2,
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── 01 ───────────────────────────────────────────────────────────────────
  scoped(/^a launcher that backgrounds a daemon which writes a marker file$/, (ctx) => {
    // The wait scenarios assert nothing about node's origin, but they still
    // launch a daemon - so they use the constructed farm too rather than the
    // host's PATH. No literal in this file now depends on what is installed.
    ctx.launch = launchDaemon({ callerPath: callerNodePath().callerPath });
    assert.equal(ctx.launch.result.status, 0, `the launcher failed: ${ctx.launch.result.stderr}`);
    ctx.writesMarker = true;
  });

  scoped(/^a backgrounded daemon that never writes its marker$/, (ctx) => {
    ctx.launch = launchDaemon({ callerPath: callerNodePath().callerPath, writesMarker: false });
    assert.equal(ctx.launch.result.status, 0, `the launcher failed: ${ctx.launch.result.stderr}`);
    ctx.writesMarker = false;
  });

  scoped(/^the test asserts on that marker$/, (ctx) => {
    ctx.startedAt = Date.now();
    ctx.wait = waitForMarker(ctx.launch, SCENARIO_TIMEOUT_MS);
    ctx.elapsedMs = Date.now() - ctx.startedAt;
    ctx.launch.kill();
  });

  scoped(/^it waits for the marker under a bounded deadline before asserting$/, (ctx) => {
    assert.equal(ctx.wait.ok, true, 'the marker a running child does write must be seen');
    // The read is not instantaneous-and-lucky: the launcher had returned before
    // the wait began, which is exactly the race, and the wait is what closed
    // it. Bounded means it could not have run past the deadline.
    assert.ok(
      ctx.elapsedMs <= SCENARIO_TIMEOUT_MS,
      `the wait must be bounded by its deadline, took ${ctx.elapsedMs}ms of ${SCENARIO_TIMEOUT_MS}ms`
    );
    assert.equal(ctx.wait.contents.trim().split('\n').filter(Boolean).length, 2,
      'the wait must return COMPLETE contents, not a half-written file');
  });

  // ── 02 ───────────────────────────────────────────────────────────────────
  scoped(/^the test fails only after the bounded deadline elapses$/, (ctx) => {
    assert.equal(ctx.wait.ok, false, 'a child that never writes must not be reported as having written');
    // "only after": it waited the whole deadline rather than failing instantly
    // on a race...
    assert.ok(
      ctx.elapsedMs >= SCENARIO_TIMEOUT_MS,
      `expected the full ${SCENARIO_TIMEOUT_MS}ms deadline, gave up after ${ctx.elapsedMs}ms`
    );
    // ...and it stopped there rather than hanging out the lane's budget.
    assert.ok(
      ctx.elapsedMs < SCENARIO_TIMEOUT_MS * 3,
      `the wait must be bounded, took ${ctx.elapsedMs}ms`
    );
  });

  scoped(/^the failure names the marker that never appeared$/, (ctx) => {
    const { describeWaitTimeout } = require(path.join(
      REPO_ROOT, 'extension', 'test', 'helpers', 'waitForFileSync.js'
    ));
    const message = describeWaitTimeout(ctx.launch.marker, SCENARIO_TIMEOUT_MS, 'label');
    assert.ok(
      message.includes(ctx.launch.marker),
      `the failure must name the marker path, got: ${message}`
    );
    assert.ok(
      message.includes(String(SCENARIO_TIMEOUT_MS)),
      `the failure must name the deadline it waited, got: ${message}`
    );
    cleanup();
  });

  // ── 03 ───────────────────────────────────────────────────────────────────
  scoped(/^the wait is inspected$/, (ctx) => {
    // Driven, not read: a fake clock and a fake sleep make both halves
    // observable without spending real time on either.
    const dir = mkTmp('bl1063-inspect-');
    const missing = path.join(dir, 'never.txt');
    const present = path.join(dir, 'now.txt');
    fs.writeFileSync(present, 'a\nb\n');

    let clock = 0;
    const sleeps = [];
    const fake = { now: () => clock, sleep: (ms) => { sleeps.push(ms); clock += ms; } };

    ctx.missingResult = waitForFileSync(missing, { timeoutMs: 1000, pollMs: 40, ...fake });
    ctx.sleeps = [...sleeps];
    sleeps.length = 0;
    clock = 0;
    ctx.presentResult = waitForFileSync(present, { timeoutMs: 1000, pollMs: 40, ...fake });
    ctx.presentSleeps = [...sleeps];
  });

  scoped(/^it polls under a declared maximum deadline$/, (ctx) => {
    assert.equal(ctx.missingResult.ok, false);
    assert.ok(ctx.sleeps.length > 1, `expected repeated polling, slept ${ctx.sleeps.length} time(s)`);
    // Declared, and never overshot: the last poll is trimmed to the remaining
    // budget rather than straddling the deadline.
    assert.equal(
      ctx.sleeps.reduce((a, b) => a + b, 0),
      1000,
      `polling must total exactly the declared deadline, got ${ctx.sleeps.reduce((a, b) => a + b, 0)}`
    );
    assert.ok(
      ctx.sleeps.every((ms) => ms <= 40),
      `no single poll may exceed the interval, got: ${ctx.sleeps.join(',')}`
    );
    // And the module declares a default rather than leaving it to each caller.
    assert.equal(typeof DEFAULT_TIMEOUT_MS, 'number');
  });

  scoped(/^it returns as soon as the marker appears$/, (ctx) => {
    assert.equal(ctx.presentResult.ok, true);
    // Zero sleeps: an already-present marker costs nothing at all. A fixed
    // sleep would show up here as the whole interval, every run.
    assert.deepEqual(ctx.presentSleeps, [], 'a marker already present must be returned without waiting');
    assert.equal(ctx.presentResult.waitedMs, 0);
    cleanup();
  });

  // ── 04 / 05 / 06 ─────────────────────────────────────────────────────────
  scoped(/^a caller PATH on which node "(resolves|does not resolve)"$/, (ctx, shape) => {
    ctx.callerResolvesNode = shape === 'resolves';
    const caller = ctx.callerResolvesNode ? callerNodePath() : null;
    ctx.callerNode = caller ? caller.stub : null;
    ctx.callerPath = caller ? caller.callerPath : nodelessPath();
  });

  scoped(/^a caller PATH that already resolves node$/, (ctx) => {
    // Constructed, not found: the scenario no longer requires anything of the
    // host, so there is no premise to check and no host on which it fails for
    // a reason that is not about the code.
    const caller = callerNodePath();
    ctx.callerResolvesNode = true;
    ctx.callerPath = caller.callerPath;
    ctx.callerNode = caller.stub;
  });

  scoped(/^a host that "(carries|lacks)" a system node$/, (ctx, host) => {
    // The host itself cannot be changed, so the condition it stands for is
    // reproduced exactly: whether the caller PATH the daemon inherits resolves
    // node. That IS what "the host carries a system node" means to this code.
    ctx.callerResolvesNode = host === 'carries';
    const caller = ctx.callerResolvesNode ? callerNodePath() : null;
    ctx.callerNode = caller ? caller.stub : null;
    ctx.callerPath = caller ? caller.callerPath : nodelessPath();
  });

  const checkInvariantOne = (ctx) => {
    ctx.launch = launchDaemon({ callerPath: ctx.callerPath });
    assert.equal(ctx.launch.result.status, 0, `the launcher failed: ${ctx.launch.result.stderr}`);
    ctx.wait = waitForMarker(ctx.launch, DEFAULT_TIMEOUT_MS);
    ctx.launch.kill();
    assert.ok(ctx.wait.ok, `the launched daemon never reported: ${ctx.launch.marker}`);
    const lines = ctx.wait.contents.trim().split('\n');
    ctx.resolvedBb = lines[0];
    ctx.resolvedNode = lines[1];
  };

  scoped(/^the launched daemon's PATH is checked against invariant 1$/, checkInvariantOne);
  scoped(/^the property file is run$/, checkInvariantOne);

  scoped(/^node resolves for the daemon$/, (ctx) => {
    assert.ok(ctx.resolvedNode, 'node must resolve at all - that is what invariant 1 claims');
    assert.ok(fs.existsSync(ctx.resolvedNode), `node must resolve to a real path, got: ${ctx.resolvedNode}`);
  });

  scoped(/^the check is satisfied by "(the caller's node|the nvm fallback)"$/, (ctx, origin) => {
    const fromNvm = ctx.resolvedNode.startsWith(ctx.launch.nvmTree);
    if (origin === 'the nvm fallback') {
      assert.ok(fromNvm, `expected the nvm fallback to answer, got: ${ctx.resolvedNode}`);
    } else {
      assert.ok(!fromNvm, `expected the caller's own node, got the nvm tree: ${ctx.resolvedNode}`);
    }
    cleanup();
  });

  scoped(/^the caller's own node is accepted$/, (ctx) => {
    assert.equal(
      ctx.resolvedNode,
      ctx.callerNode,
      `the caller's own node ("${ctx.callerNode}") must be what the daemon got, unshadowed`
    );
  });

  scoped(/^the nvm fallback is not required$/, (ctx) => {
    // The old assertion demanded exactly this and was therefore red whenever
    // the lib behaved correctly - operator_path_lib.sh is REQUIRED never to
    // shadow a node the caller already resolves (BL-796 invariant 3).
    assert.ok(
      !ctx.resolvedNode.startsWith(ctx.launch.nvmTree),
      `the nvm fallback must not shadow the caller's node, got: ${ctx.resolvedNode}`
    );
    cleanup();
  });

  scoped(/^invariant 1 passes$/, (ctx) => {
    assert.ok(ctx.resolvedBb, 'bb must resolve');
    assert.ok(ctx.resolvedNode && fs.existsSync(ctx.resolvedNode), 'node must resolve');
    // The whole point of scenario 06: the same verdict either way. Neither row
    // asserts WHERE node came from, because that is the host's business and
    // not the invariant's.
    cleanup();
  });
}

module.exports = { registerSteps };
