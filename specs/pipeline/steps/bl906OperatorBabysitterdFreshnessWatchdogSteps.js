'use strict';

// BL-906: step handlers for "Operator watches babysitterd and tells, never
// restarts". Drives REAL scripts, never a parallel reimplementation
// (bl611BabysitterdLifecycleSteps.js's own stated posture):
//
//   - Scenarios 01/02/07 (classification + tell-not-restart + opt-out) drive
//     the real operator_runtime.bb --tick-once via a sandboxed copy, the
//     same idiom test_operator_runtime_babysitterd_watchdog.sh already
//     established (bl671's shared operator_runtime_sandbox.sh helper) - the
//     sandbox is what lets a tripwire start_babysitterd.sh stub sit right
//     next to it and catch the one call this ticket forbids, and what makes
//     the real swarm_handoff.bb send path resolve entirely inside the
//     disposable fixture root, never the live swarm's own mailbox.
//   - Scenario 03 is a grep-shaped source check (bl611's own scenario-15
//     idiom): no non-comment line in the real operator_runtime.bb may
//     reference start_babysitterd - the file's own header comments mention
//     the filename descriptively, so only code lines are scrutinized.
//   - Scenarios 04/05/06 (adopt-not-spawn, status truth) drive the real
//     start_babysitterd.sh / swarm_status.bb directly against a disposable
//     root, the same idiom bl611BabysitterdLifecycleSteps.js already uses
//     for its own lifecycle scenarios - no sandboxing needed since these
//     scripts don't load-file operator_runtime's dependency web.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_DIR = path.join(SCRIPTS, 'test');
const SANDBOX_HELPER = path.join(TEST_DIR, 'lib', 'operator_runtime_sandbox.sh');
const START_BABYSITTERD_SH = path.join(SCRIPTS, 'start_babysitterd.sh');
const SWARM_STATUS_BB = path.join(SCRIPTS, 'swarm_status.bb');
const OPERATOR_RUNTIME_BB = path.join(SCRIPTS, 'operator_runtime.bb');

const FEATURE = 'Operator watches babysitterd and tells, never restarts';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

// ── shared process bookkeeping (mirrors bl611BabysitterdLifecycleSteps.js) ─
const LIVE_PIDS = new Set();
function trackPid(pid) {
  if (pid) LIVE_PIDS.add(pid);
}
function reapPid(pid) {
  if (!pid) return;
  // Verify-and-retry rather than a single fire-and-forget kill - cheap
  // insurance against a SIGKILL racing a not-yet-fully-forked child.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      LIVE_PIDS.delete(pid);
      return; // ESRCH - already gone
    }
    const until = Date.now() + 100;
    while (Date.now() < until) {
      /* bounded busy-wait, no external sleep dependency */
    }
    try {
      process.kill(pid, 0);
    } catch {
      LIVE_PIDS.delete(pid);
      return; // confirmed dead
    }
  }
  LIVE_PIDS.delete(pid);
}
process.on('exit', () => {
  for (const pid of LIVE_PIDS) reapPid(pid);
});

function pidFile(root) {
  return path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.pid');
}
function readPid(root) {
  const p = pidFile(root);
  if (!fs.existsSync(p)) return null;
  const s = fs.readFileSync(p, 'utf8').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function waitFor(predicate, { tries = 25, intervalMs = 200 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return true;
    const until = Date.now() + intervalMs;
    while (Date.now() < until) {
      /* bounded busy-wait, no external sleep dependency */
    }
  }
  return predicate();
}

// ── scenarios 01/02/07: sandboxed operator_runtime.bb ──────────────────────
function mkOperatorFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl906-op-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  const copy = spawnSync(
    'bash',
    ['-c', 'source "$1"; copy_operator_runtime_sandbox "$2" "$3"', '_', SANDBOX_HELPER, SCRIPTS, path.join(root, 'swarmforge', 'scripts')],
    { encoding: 'utf8' }
  );
  if (copy.status !== 0) {
    throw new Error(`operator_runtime sandbox copy failed:\n${copy.stdout}\n${copy.stderr}`);
  }
  fs.writeFileSync(path.join(root, '.process-snapshot.json'), '[]\n');
  // Tripwire (test_operator_runtime_babysitterd_watchdog.sh's own idiom): if
  // the Operator ever calls this, the sweep grew a restart path.
  const tripwire = path.join(root, 'swarmforge', 'scripts', 'start_babysitterd.sh');
  fs.writeFileSync(
    tripwire,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'ROOT="${1:?root required}"',
      'mkdir -p "$ROOT/.swarmforge/operator"',
      'echo restarted >> "$ROOT/.swarmforge/operator/babysitterd-restarted.marker"',
      '',
    ].join('\n')
  );
  fs.chmodSync(tripwire, 0o755);
  return root;
}

function neverRestarted(root) {
  return !fs.existsSync(path.join(root, '.swarmforge', 'operator', 'babysitterd-restarted.marker'));
}

function startFakeDaemon(root) {
  const script = path.join(root, 'babysitterd.sh');
  fs.writeFileSync(script, '#!/usr/bin/env bash\nexec sleep 300\n');
  fs.chmodSync(script, 0o755);
  // nohup+disown via bash itself (test_operator_runtime_babysitterd_watchdog.sh's
  // own start_fake_daemon() idiom, reused verbatim) rather than Node's own
  // spawn({detached,unref}) - the proven-reliable mechanism the existing
  // shell fixture already relies on.
  const result = spawnSync('bash', ['-c', 'nohup bash "$1" "$2" >/dev/null 2>&1 & disown; echo $!', '_', script, root], {
    encoding: 'utf8',
  });
  const pid = parseInt((result.stdout || '').trim(), 10);
  if (!pid) {
    throw new Error(`failed to start fake daemon:\n${result.stdout}\n${result.stderr}`);
  }
  trackPid(pid);
  const snapshot = [{ pid, cmdline: `bash ${script} ${root}` }];
  fs.writeFileSync(path.join(root, '.process-snapshot.json'), `${JSON.stringify(snapshot)}\n`);
  return pid;
}

function tickOperator(root, extraEnv) {
  const emptyFleet = path.join(root, '.empty-fleet-home');
  fs.mkdirSync(emptyFleet, { recursive: true });
  const base = { ...process.env };
  // Same ambient scrub test_operator_runtime_babysitterd_watchdog.sh's own
  // tick() performs - an agent worktree pane routinely exports these for its
  // own safety, and they must never leak into what this fixture measures.
  delete base.TELEGRAM_BOT_TOKEN;
  delete base.TELEGRAM_CHAT_ID;
  delete base.TELEGRAM_PRINCIPAL_USER_ID;
  delete base.SWARMFORGE_SKIP_BABYSITTERD;
  const env = {
    ...base,
    OPERATOR_SKIP_LAUNCH: '1',
    OPERATOR_MINIAPP_WATCHDOG_ENABLED: '0',
    OPERATOR_CURSOR_BRIDGE_WATCHDOG_ENABLED: '0',
    SWARMFORGE_SKIP_BABYSITTERD: '0',
    SWARMFORGE_SANDBOX_SWEEP_ROOT: path.join(root, '.no-sandbox-sweep'),
    SWARMFORGE_FIXTURE_REAP_ROOT: path.join(root, '.no-fixture-reap'),
    SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS: '',
    SWARMFORGE_FLEET_HOME: emptyFleet,
    SWARMFORGE_BABYSITTERD_PROCESS_SNAPSHOT: path.join(root, '.process-snapshot.json'),
    ...extraEnv,
  };
  const result = spawnSync('bb', [path.join(root, 'swarmforge', 'scripts', 'operator_runtime.bb'), root, '--tick-once'], {
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) {
    throw new Error(`operator_runtime.bb --tick-once failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function readStatusField(root, keys) {
  const p = path.join(root, '.swarmforge', 'operator', 'status.json');
  if (!fs.existsSync(p)) return undefined;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return keys.reduce((acc, k) => (acc == null ? acc : acc[k]), data);
}

// ── scenarios 04/05/06: real start_babysitterd.sh / swarm_status.bb ────────
function startLifecycleFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl906-lc-'));
  // babysitterd.sh's own tick loop shells out to `sleep "$INTERVAL_S"`
  // (default 300) as a CHILD of the daemon's own pid - SIGKILL to the
  // daemon's pid does not cascade to that in-flight child (no setsid on
  // macOS to group them), so it would otherwise survive as an orphan for up
  // to 5 minutes after this fixture kills the daemon. A short interval
  // makes any such orphan self-terminate almost immediately instead.
  const startResult = spawnSync('bash', [START_BABYSITTERD_SH, root], {
    encoding: 'utf8',
    env: { ...process.env, BABYSITTERD_INTERVAL_S: '1' },
  });
  if (startResult.status !== 0) {
    throw new Error(`start_babysitterd.sh failed:\n${startResult.stdout}\n${startResult.stderr}`);
  }
  const ok = waitFor(() => pidAlive(readPid(root)));
  if (!ok) {
    throw new Error(`babysitterd never produced a live pidfile in ${root}`);
  }
  const pid = readPid(root);
  trackPid(pid);
  return { root, pid };
}

function runSwarmStatus(root) {
  return spawnSync('bb', [SWARM_STATUS_BB, root], { encoding: 'utf8' });
}

function babysitterdStatusLine(output) {
  return (output || '').split('\n').find((l) => /babysitterd/i.test(l)) || '';
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  scoped(registry, /^an Operator runtime with the babysitterd watchdog enabled$/, () => {
    /* framing only - each scenario's own Given steps build their own fixture and env */
  });

  // ── Scenario 01 (Outline): each observable condition classifies to its
  //    own state - drives the real classify path end to end, never a
  //    hand-rolled oracle, so the priority order (down > pidfile-lie >
  //    announce-mute > healthy) is proven against the shipped code. ───────
  scoped(registry, /^the babysitterd process is (alive|absent)$/, (ctx, word) => {
    const root = mkOperatorFixture();
    ctx.bl906 = { root, pid: null, announceWorking: false };
    if (word === 'alive') {
      ctx.bl906.pid = startFakeDaemon(root);
    }
  });

  scoped(registry, /^the pidfile is (correct|absent)$/, (ctx, word) => {
    // Shared with scenario 06's own "And the pidfile is absent" line, which
    // targets the lifecycle fixture instead - dispatch on which fixture
    // this scenario actually populated.
    if (ctx.bl906Lifecycle) {
      if (word === 'absent') fs.unlinkSync(pidFile(ctx.bl906Lifecycle.root));
      return;
    }
    const st = ctx.bl906;
    if (word === 'correct' && st.pid) {
      fs.mkdirSync(path.dirname(pidFile(st.root)), { recursive: true });
      fs.writeFileSync(pidFile(st.root), String(st.pid));
    }
    // 'absent' on the operator fixture: nothing was ever written - no-op.
  });

  scoped(registry, /^the announce path is (working|silent)$/, (ctx, word) => {
    ctx.bl906.announceWorking = word === 'working';
  });

  scoped(registry, /^the watchdog classifies babysitterd$/, (ctx) => {
    const st = ctx.bl906;
    const extraEnv = {
      OPERATOR_BABYSITTERD_WATCHDOG_ENABLED: '1',
      OPERATOR_BABYSITTERD_WATCHDOG_COOLDOWN_MS: '0',
    };
    if (st.announceWorking) {
      extraEnv.TELEGRAM_BOT_TOKEN = 't';
      extraEnv.TELEGRAM_CHAT_ID = '1';
    }
    st.tickResult = tickOperator(st.root, extraEnv);
  });

  scoped(registry, /^the reported state is (healthy|down|pidfile-lie|announce-mute)$/, (ctx, expected) => {
    const state = readStatusField(ctx.bl906.root, ['babysitterd_watchdog', 'state']);
    // Reap BEFORE asserting: this scenario's own assertion failing must not
    // leak the fake daemon (an explicit belt-and-suspenders reap, not only
    // the exit-time backstop - the same posture bl611BabysitterdLifecycleSteps.js
    // uses at each scenario's own last needed-alive point).
    reapPid(ctx.bl906.pid);
    if (state !== expected) {
      throw new Error(`expected state "${expected}"; got "${state}" (status.json), tick output:\n${ctx.bl906.tickResult.stdout}`);
    }
  });

  // ── Scenario 02: an unhealthy poll tells, and starts nothing ────────────
  scoped(registry, /^the Operator runtime ticks$/, (ctx) => {
    const st = ctx.bl906;
    const optedOut = Boolean(ctx.bl906OptOut);
    const extraEnv = {
      OPERATOR_BABYSITTERD_WATCHDOG_ENABLED: optedOut ? '0' : '1',
      OPERATOR_BABYSITTERD_WATCHDOG_COOLDOWN_MS: '0',
    };
    if (!optedOut) {
      extraEnv.TELEGRAM_BOT_TOKEN = 't';
      extraEnv.TELEGRAM_CHAT_ID = '1';
    }
    st.tickResult = tickOperator(st.root, extraEnv);
  });

  scoped(registry, /^a note is sent to the coordinator$/, (ctx) => {
    const draftsDir = path.join(ctx.bl906.root, '.swarmforge', 'operator', 'babysitterd-watchdog-drafts');
    if (!fs.existsSync(draftsDir) || fs.readdirSync(draftsDir).length === 0) {
      throw new Error(`expected a coordinator draft in ${draftsDir}`);
    }
  });

  scoped(registry, /^the status file records the watchdog state$/, (ctx) => {
    const state = readStatusField(ctx.bl906.root, ['babysitterd_watchdog', 'state']);
    if (!state) throw new Error('expected status.json to record a babysitterd_watchdog.state');
  });

  scoped(registry, /^no babysitterd process is started$/, (ctx) => {
    if (!neverRestarted(ctx.bl906.root)) {
      throw new Error('the tripwire start_babysitterd.sh marker was written - Operator started babysitterd');
    }
  });

  // ── Scenario 03: the Operator runtime has no way to start babysitterd ──
  scoped(registry, /^the Operator runtime source is inspected$/, (ctx) => {
    ctx.bl906Source = fs.readFileSync(OPERATOR_RUNTIME_BB, 'utf8');
  });

  scoped(registry, /^it contains no call site that starts babysitterd$/, (ctx) => {
    // The file's own comments document this exact prohibition by naming the
    // filename ("never calls start_babysitterd.sh") - only non-comment
    // lines are scrutinized, or every clean run would false-positive on its
    // own documentation.
    const offenders = ctx.bl906Source
      .split('\n')
      .filter((line) => !line.trim().startsWith(';;'))
      .filter((line) => /start_babysitterd/i.test(line));
    if (offenders.length > 0) {
      throw new Error(`operator_runtime.bb has a non-comment reference to start_babysitterd:\n${offenders.join('\n')}`);
    }
  });

  // ── Scenarios 04/05/06: real start_babysitterd.sh adopt / swarm_status.bb ─
  scoped(registry, /^a live babysitterd process$/, (ctx) => {
    const fx = startLifecycleFixture();
    ctx.bl906Lifecycle = { ...fx, originalPid: fx.pid };
  });

  scoped(registry, /^a live orphaned babysitterd process$/, (ctx) => {
    const fx = startLifecycleFixture();
    fs.unlinkSync(pidFile(fx.root));
    if (!pidAlive(fx.pid)) {
      throw new Error('babysitterd died after pidfile removal (orphaning failed)');
    }
    ctx.bl906Lifecycle = { ...fx, originalPid: fx.pid };
  });

  scoped(registry, /^a second launch is run and exits$/, (ctx) => {
    const st = ctx.bl906Lifecycle;
    st.launch = spawnSync('bash', [START_BABYSITTERD_SH, st.root], { encoding: 'utf8' });
    if (st.launch.status !== 0) {
      throw new Error(`second start_babysitterd.sh launch failed:\n${st.launch.stdout}\n${st.launch.stderr}`);
    }
  });

  scoped(registry, /^the pidfile still names the live process$/, (ctx) => {
    const st = ctx.bl906Lifecycle;
    const pid = readPid(st.root);
    if (pid !== st.originalPid) {
      throw new Error(`expected the pidfile to still name ${st.originalPid}; got ${pid}`);
    }
    if (!pidAlive(st.originalPid)) {
      throw new Error(`the original babysitterd process (pid ${st.originalPid}) is no longer alive`);
    }
  });

  scoped(registry, /^the reported status is not down$/, (ctx) => {
    const st = ctx.bl906Lifecycle;
    st.statusResult = runSwarmStatus(st.root);
    reapPid(st.originalPid);
    const line = babysitterdStatusLine(st.statusResult.stdout);
    if (!line) throw new Error(`no babysitterd row in swarm status output:\n${st.statusResult.stdout}`);
    if (/\bDOWN\b/.test(line)) throw new Error(`expected babysitterd status not to read DOWN; got: ${line}`);
  });

  scoped(registry, /^a launch is run$/, (ctx) => {
    const st = ctx.bl906Lifecycle;
    st.launch = spawnSync('bash', [START_BABYSITTERD_SH, st.root], { encoding: 'utf8' });
    if (st.launch.status !== 0) {
      throw new Error(`start_babysitterd.sh (adopt) failed:\n${st.launch.stdout}\n${st.launch.stderr}`);
    }
  });

  scoped(registry, /^exactly one babysitterd process is running$/, (ctx) => {
    const st = ctx.bl906Lifecycle;
    if (!pidAlive(st.originalPid)) {
      throw new Error(`the original babysitterd process (pid ${st.originalPid}) is not running after the launch`);
    }
    // "exactly one": the launch output itself must confirm adoption, not a
    // fresh spawn - a bare process-count grep is both racy and PID-reuse
    // fragile, the same reason test_babysitterd_lifecycle.sh checks the
    // script's own confirmation text instead.
    const out = st.launch.stdout || '';
    if (!/already running/i.test(out)) {
      throw new Error(`expected an adopt/already-running confirmation, not a fresh spawn; got: ${out}`);
    }
  });

  scoped(registry, /^the pidfile names that process$/, (ctx) => {
    const st = ctx.bl906Lifecycle;
    const pid = readPid(st.root);
    reapPid(st.originalPid);
    if (pid !== st.originalPid) {
      throw new Error(`expected the pidfile to name the adopted process ${st.originalPid}; got ${pid}`);
    }
  });

  scoped(registry, /^the swarm status is reported$/, (ctx) => {
    ctx.bl906Lifecycle.statusResult = runSwarmStatus(ctx.bl906Lifecycle.root);
  });

  scoped(registry, /^babysitterd is reported as adopted-live$/, (ctx) => {
    const st = ctx.bl906Lifecycle;
    reapPid(st.originalPid);
    const line = babysitterdStatusLine(st.statusResult.stdout);
    if (!/adopted-live/i.test(line)) {
      throw new Error(`expected the babysitterd row to read adopted-live; got: ${line}`);
    }
  });

  // ── Scenario 07: the watchdog can be disabled ───────────────────────────
  scoped(registry, /^the babysitterd watchdog is disabled by its opt-out$/, (ctx) => {
    ctx.bl906OptOut = true;
  });

  scoped(registry, /^no note is sent to the coordinator$/, (ctx) => {
    const draftsDir = path.join(ctx.bl906.root, '.swarmforge', 'operator', 'babysitterd-watchdog-drafts');
    if (fs.existsSync(draftsDir) && fs.readdirSync(draftsDir).length > 0) {
      throw new Error(`expected no coordinator draft while opted out; found: ${fs.readdirSync(draftsDir).join(', ')}`);
    }
  });
}

module.exports = { registerSteps };
