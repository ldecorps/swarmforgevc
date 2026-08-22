'use strict';

// BL-967: step handlers for "handoffd cycle stall - bounded waits and
// self-localizing sweep boundaries". Each scenario runs the REAL
// handoffd.bb in a throwaway fixture root with a fake tmux on PATH (the
// daemon wiring tests' standard recipe), the wait bound scaled down via the
// SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS env seam, and the daemon's
// stdout/stderr redirected to a file (engineering rules: env-seam timeouts,
// output to a file, never kill() of the test process as an assertion
// mechanism - kill here is only the cleanup backstop). Fixture roots are
// tracked and removed in afterEach, never leaked.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

const FEATURE_NAME = 'BL-967 handoffd cycle stall - bounded waits and self-localizing sweep boundaries';

// The heavy bundle at this commit - the KNOWN_VALUES list scenario 02's
// boundary assertion checks against (a sweep added to the daemon without a
// boundary line fails loudly here).
const HEAVY_BUNDLE_SWEEPS = [
  'chase-sweep',
  'dispatch-gap-sweep',
  'unassigned-active-nudge-sweep',
  'open-slot-nudge-sweep',
  'dropped-parcel-sweep',
  'batch-claim-progress-sweep',
  'flow-watchdog-sweep',
  'master-checkout-drift-sweep',
  'ambulance-auto-exit-sweep',
  'ensure-lifecycle-snapshot',
  'briefing-email-sweep',
  'briefing-generation-sweep',
  'closing-context-clear-sweep',
  'role-context-clear-sweep',
  'dead-letter-notify-sweep',
  'resource-sample-sweep',
  'push-sweep',
  'master-main-reconcile-sweep',
  'fleet-status-sweep',
  'answer-file-drain-sweep',
  'pause-auto-resume-sweep',
  'cooldown-sweep',
];

// Scaled down from the live 60s default, but with headroom for legitimate
// child startup (the sweeps spawn real `bb`/`node` CLIs whose interpreter
// boot can pass 500ms under suite load - observed flaking scenario 04 at a
// 500ms bound). The injected hang sleeps 3600s, so any bound catches it.
const WAIT_BOUND_MS = 5000;

let trackedRoots = [];
let trackedPids = [];
afterEach(() => {
  while (trackedPids.length) {
    try {
      process.kill(trackedPids.pop(), 'SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
});

function initRoot(ctx) {
  ctx.root = mkSocketFixtureRoot('bl967-cycle-');
  trackedRoots.push(ctx.root);
  const sf = path.join(ctx.root, '.swarmforge');
  fs.mkdirSync(path.join(sf, 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(sf, 'daemon'), { recursive: true });
  const sock = path.join(ctx.root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(sf, 'tmux-socket'), `${sock}\n`);
  fs.writeFileSync(
    path.join(sf, 'roles.tsv'),
    `coder\tcoder\t${ctx.root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  ctx.binDir = path.join(ctx.root, 'bin');
  fs.mkdirSync(ctx.binDir);
  ctx.logPath = path.join(sf, 'daemon', 'handoffd.log');
  ctx.daemonOut = path.join(ctx.root, 'daemon-out.log');
}

function writeFakeTmux(ctx, body) {
  const script = `#!/usr/bin/env bash\n${body}\n`;
  fs.writeFileSync(path.join(ctx.binDir, 'tmux'), script, { mode: 0o755 });
}

function logText(ctx) {
  return fs.existsSync(ctx.logPath) ? fs.readFileSync(ctx.logPath, 'utf8') : '';
}

function cycleEndSeen(ctx, cycle) {
  return new RegExp(`heartbeat cycle=${cycle}$`, 'm').test(logText(ctx));
}

// Runs the daemon until the given cycle's END heartbeat lands (or the
// deadline passes), then stops it cleanly via the stop file.
async function runDaemonUntilCycleEnd(ctx, cycle, deadlineMs) {
  const outFd = fs.openSync(ctx.daemonOut, 'a');
  const child = spawn('bb', [HANDOFFD, ctx.root], {
    env: {
      PATH: `${ctx.binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      SWARMFORGE_ALLOW_TMP_DAEMON: '1',
      SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS: String(WAIT_BOUND_MS),
    },
    stdio: ['ignore', outFd, outFd],
  });
  trackedPids.push(child.pid);
  ctx.daemonStartMs = Date.now();
  try {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline && !cycleEndSeen(ctx, cycle)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    ctx.cycleEndMs = Date.now();
    ctx.sawCycleEnd = cycleEndSeen(ctx, cycle);
  } finally {
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'stop'), '');
    const gone = Date.now() + 10000;
    while (Date.now() < gone) {
      try {
        process.kill(child.pid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch (_) {
        break;
      }
    }
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch (_) {
      /* exited cleanly */
    }
    fs.closeSync(outFd);
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture daemon cycle wired through the test seams with a freshness threshold budget$/, (ctx) => {
    initRoot(ctx);
    // The fixture's scaled-down stand-in for the live 300s threshold: with
    // the wait bound at WAIT_BOUND_MS (5000), a bounded cycle must land
    // well inside this.
    ctx.thresholdBudgetMs = 60000;
  });

  // ── Givens ────────────────────────────────────────────────────────────
  scoped(/^one sweep's injected subprocess hangs past the configured wait bound$/, (ctx) => {
    // The FIRST capture-pane call hangs far past the bound (a wedged tmux
    // server); every other call answers instantly. One hung child, once.
    writeFakeTmux(
      ctx,
      `marker="$(dirname "$0")/../hang-consumed"
if [[ "$*" == *capture-pane* && ! -e "$marker" ]]; then
  touch "$marker"
  sleep 3600
fi
exit 0`
    );
    ctx.injectedHang = true;
  });

  scoped(/^no sweep has any action to take$/, (ctx) => {
    writeFakeTmux(ctx, 'exit 0');
  });

  scoped(
    /^every sweep completes normally but the cycle's total duration approaches the threshold budget$/,
    (ctx) => {
      // Slow-but-healthy: every tmux call costs real time UNDER the wait
      // bound, so the whole cycle is slow without any single wait hanging
      // (the BL-789 posture the ticket's regression step protects).
      writeFakeTmux(ctx, 'sleep 0.2\nexit 0');
    }
  );

  // ── Whens ─────────────────────────────────────────────────────────────
  scoped(/^the daemon runs a heavy cycle$/, async (ctx) => {
    // Cycle 0 is heavy (cycle mod chase-sweep-every-cycles == 0).
    await runDaemonUntilCycleEnd(ctx, 0, ctx.thresholdBudgetMs);
    assert.ok(
      ctx.sawCycleEnd,
      `cycle 0 never completed within the budget; log:\n${logText(ctx).slice(-2000)}\ndaemon out:\n${fs.readFileSync(ctx.daemonOut, 'utf8').slice(-1000)}`
    );
  });

  scoped(/^the daemon runs a fast poll tick that is not a heavy cycle$/, async (ctx) => {
    // Run past cycle 1 (a plain 1s tick) and remember the boundary-line
    // count as of cycle 0's end for the Then to compare against.
    await runDaemonUntilCycleEnd(ctx, 1, ctx.thresholdBudgetMs);
    assert.ok(ctx.sawCycleEnd, `cycle 1 never completed; log:\n${logText(ctx).slice(-2000)}`);
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  scoped(/^the cycle logs a timeout naming that sweep and call$/, (ctx) => {
    const m = logText(ctx).match(/subprocess-timeout sweep=([a-z-]+) bound-ms=(\d+) cmd=(\S+)/);
    assert.ok(m, `no attributed subprocess-timeout line; log:\n${logText(ctx).slice(-2000)}`);
    assert.notEqual(m[1], 'outside-sweep', `timeout not attributed to a sweep: ${m[0]}`);
    assert.equal(Number(m[2]), WAIT_BOUND_MS, `wrong bound in ${m[0]}`);
    assert.equal(m[3], 'tmux', `timeout does not name the hung call: ${m[0]}`);
  });

  scoped(/^the cycle completes with its end-of-cycle heartbeat inside the threshold budget$/, (ctx) => {
    assert.ok(cycleEndSeen(ctx, 0), 'end-of-cycle heartbeat missing');
    const elapsed = ctx.cycleEndMs - ctx.daemonStartMs;
    assert.ok(
      elapsed < ctx.thresholdBudgetMs,
      `cycle took ${elapsed}ms against the ${ctx.thresholdBudgetMs}ms budget`
    );
  });

  scoped(/^the log carries one boundary line per sweep in the heavy bundle, each with a duration$/, (ctx) => {
    const text = logText(ctx);
    for (const sweep of HEAVY_BUNDLE_SWEEPS) {
      const lines = text.match(new RegExp(`sweep-boundary sweep=${sweep} ms=\\d+$`, 'gm')) || [];
      assert.equal(
        lines.length,
        1,
        `expected exactly one boundary for ${sweep}, got ${lines.length}; log:\n${text.slice(-3000)}`
      );
    }
  });

  scoped(/^the log gains no sweep boundary lines from that tick$/, (ctx) => {
    // Every boundary line present belongs to heavy cycle 0; the cycle-1
    // tick added none. With one heavy cycle run, that means the total
    // boundary count is exactly one per heavy-bundle sweep.
    const boundaries = logText(ctx).match(/sweep-boundary sweep=/g) || [];
    assert.equal(
      boundaries.length,
      HEAVY_BUNDLE_SWEEPS.length,
      `boundary lines changed on a non-heavy tick: ${boundaries.length} != ${HEAVY_BUNDLE_SWEEPS.length}`
    );
  });

  scoped(/^the cycle completes with no timeout logged$/, (ctx) => {
    assert.ok(!logText(ctx).includes('subprocess-timeout'), `unexpected timeout:\n${logText(ctx).slice(-2000)}`);
  });

  scoped(/^the end-of-cycle heartbeat lands$/, (ctx) => {
    assert.ok(cycleEndSeen(ctx, 0), 'end-of-cycle heartbeat missing');
  });
}

module.exports = { registerSteps };
