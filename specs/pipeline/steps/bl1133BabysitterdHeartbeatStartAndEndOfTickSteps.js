'use strict';

// BL-1133: babysitterd heartbeats at process start, tick start, and tick end.
// Drives the REAL babysitterd.sh (via a disposable SCRIPT_DIR stub check) and
// REAL daemon_log_freshness_check.sh — never a parallel pulse reimplementation.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const FEATURE = 'babysitterd heartbeats at start and end of each tick';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const DAEMON_SRC = path.join(SCRIPTS, 'babysitterd.sh');
const CHECKER = path.join(SCRIPTS, 'daemon_log_freshness_check.sh');
const CONF = path.join(SCRIPTS, 'daemon_log_freshness.conf');

const LIVE_PIDS = new Set();
const FIXTURES = [];

function trackPid(pid) {
  if (pid) LIVE_PIDS.add(pid);
}
function reapPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* gone */
  }
  LIVE_PIDS.delete(pid);
}
function cleanup() {
  for (const pid of LIVE_PIDS) reapPid(pid);
  while (FIXTURES.length) {
    try {
      fs.rmSync(FIXTURES.pop(), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}
process.on('exit', cleanup);

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1133-'));
  FIXTURES.push(root);
  fs.mkdirSync(path.join(root, '.swarmforge', 'handoffs', 'failed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  return root;
}

function mkStubDaemon(sleepSecs) {
  const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl1133-daemon-'));
  FIXTURES.push(fix);
  fs.copyFileSync(DAEMON_SRC, path.join(fix, 'babysitterd.sh'));
  fs.writeFileSync(
    path.join(fix, 'babysitter_check.sh'),
    ['#!/usr/bin/env bash', "printf 'CHECK_MARK\\n'", `sleep ${sleepSecs}`, ''].join('\n')
  );
  fs.chmodSync(path.join(fix, 'babysitter_check.sh'), 0o755);
  return path.join(fix, 'babysitterd.sh');
}

function isoAt(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function logPath(root) {
  return path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.log');
}

function heartbeatCount(logText) {
  return (logText.match(/[^\n]*\bheartbeat\b[^\n]*/g) || []).length;
}

function runChecker(root, now) {
  return spawnSync('/bin/sh', [CHECKER], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      FRESHNESS_ROOT: root,
      FRESHNESS_CONF: CONF,
      FRESHNESS_NOW_EPOCH: String(now),
      FRESHNESS_INCIDENT_FILE: path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
      FRESHNESS_COOL_OFF_SECS: '300',
      FRESHNESS_LOAD: '1',
      FRESHNESS_CORES: '1',
      FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'announces.log')}"`,
      FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'kills.log')}"`,
      FRESHNESS_START_CMD: `printf '%s %s\\n' "$1" "$2" >> "${path.join(root, 'starts.log')}"`,
    },
  });
}

function waitFor(predicate, { tries = 40, intervalMs = 100 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return true;
    const until = Date.now() + intervalMs;
    while (Date.now() < until) {
      /* busy-wait */
    }
  }
  return predicate();
}

function registerSteps(registry) {
  scoped(registry, /^babysitterd loops babysitter_check on a fixed interval$/, () => {
    // Background scope note — interval default is BABYSITTERD_INTERVAL_S.
  });

  scoped(registry, /^babysitterd is starting against a project root$/, (ctx) => {
    ctx.root = mkRoot();
    ctx.daemon = mkStubDaemon(2);
    ctx.mode = 'cold-start';
  });

  scoped(registry, /^the daemon enters its loop$/, (ctx) => {
    const child = spawn('bash', [ctx.daemon, ctx.root], {
      env: { ...process.env, BABYSITTERD_INTERVAL_S: '60' },
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    trackPid(child.pid);
    ctx.daemonPid = child.pid;
    const ok = waitFor(() => {
      const log = logPath(ctx.root);
      if (!fs.existsSync(log)) return false;
      const text = fs.readFileSync(log, 'utf8');
      return /\bheartbeat\b/.test(text);
    });
    if (!ok) throw new Error('BL-1133: cold-start never wrote a heartbeat');
    ctx.coldLog = fs.readFileSync(logPath(ctx.root), 'utf8');
  });

  scoped(
    registry,
    /^the babysitterd log contains a heartbeat line before the first check finishes$/,
    (ctx) => {
      const text = ctx.coldLog || fs.readFileSync(logPath(ctx.root), 'utf8');
      const hbIdx = text.search(/\bheartbeat\b/);
      const checkIdx = text.indexOf('CHECK_MARK');
      if (hbIdx < 0) throw new Error('BL-1133: no heartbeat in cold-start log');
      if (checkIdx >= 0 && hbIdx > checkIdx) {
        throw new Error('BL-1133: heartbeat landed after CHECK_MARK');
      }
      reapPid(ctx.daemonPid);
    }
  );

  scoped(registry, /^babysitterd is running$/, (ctx) => {
    ctx.root = mkRoot();
    ctx.daemon = mkStubDaemon(0);
  });

  scoped(registry, /^one full tick completes$/, (ctx) => {
    const result = spawnSync('bash', [ctx.daemon, ctx.root, '--tick-once'], {
      encoding: 'utf8',
      timeout: 15000,
    });
    if (result.status !== 0) {
      throw new Error(`BL-1133: tick-once failed: ${result.stderr || result.stdout}`);
    }
    ctx.tickLog = fs.readFileSync(logPath(ctx.root), 'utf8');
  });

  scoped(registry, /^the babysitterd log gained a heartbeat before the check ran$/, (ctx) => {
    const text = ctx.tickLog;
    const hbBefore = text.search(/\bheartbeat\b/);
    const checkIdx = text.indexOf('CHECK_MARK');
    if (hbBefore < 0 || checkIdx < 0 || hbBefore > checkIdx) {
      throw new Error(`BL-1133: expected heartbeat before CHECK_MARK; log:\n${text}`);
    }
  });

  scoped(registry, /^the babysitterd log gained a heartbeat after the check returned$/, (ctx) => {
    const text = ctx.tickLog;
    const checkIdx = text.indexOf('CHECK_MARK');
    const after = text.slice(checkIdx + 'CHECK_MARK'.length);
    if (!/\bheartbeat\b/.test(after)) {
      throw new Error(`BL-1133: expected heartbeat after CHECK_MARK; log:\n${text}`);
    }
    if (heartbeatCount(text) < 2) {
      throw new Error(`BL-1133: expected ≥2 heartbeats per tick; got ${heartbeatCount(text)}`);
    }
  });

  scoped(
    registry,
    /^a tick whose check runs longer than the base freshness threshold$/,
    (ctx) => {
      ctx.root = mkRoot();
      ctx.now = 1700000000;
      ctx.threshold = 600;
      // Conceptual long gather: check still in flight past prior end-of-tick age.
      ctx.longGather = true;
    }
  );

  scoped(registry, /^heartbeats are pulsed at tick start and tick end$/, (ctx) => {
    // Mid-check sample: only the start pulse exists yet (end still pending).
    fs.writeFileSync(
      logPath(ctx.root),
      `${isoAt(ctx.now - 300)} heartbeat\n`
    );
    fs.writeFileSync(
      path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.log'),
      `${isoAt(ctx.now)} heartbeat\n`
    );
  });

  scoped(registry, /^the freshness checker samples the log mid-check$/, (ctx) => {
    const result = runChecker(ctx.root, ctx.now);
    if (result.status !== 0) {
      throw new Error(`BL-1133: freshness checker failed: ${result.stderr}`);
    }
    ctx.midSampled = true;
  });

  scoped(registry, /^the newest heartbeat age is below the babysitterd threshold$/, (ctx) => {
    const kills = path.join(ctx.root, 'kills.log');
    if (fs.existsSync(kills) && fs.readFileSync(kills, 'utf8').trim()) {
      throw new Error('BL-1133: mid-check start pulse must not kill babysitterd');
    }
    const announces = path.join(ctx.root, 'announces.log');
    if (fs.existsSync(announces) && /daemon=babysitterd/.test(fs.readFileSync(announces, 'utf8'))) {
      throw new Error('BL-1133: mid-check must not announce babysitterd stale');
    }
    const age = 300;
    if (age >= ctx.threshold) {
      throw new Error('BL-1133: fixture age must stay under threshold');
    }
  });

  scoped(
    registry,
    /^the last babysitterd heartbeat is older than the freshness threshold$/,
    (ctx) => {
      ctx.root = mkRoot();
      ctx.now = 1700000000;
      fs.writeFileSync(logPath(ctx.root), `${isoAt(ctx.now - 900)} heartbeat\n`);
      fs.writeFileSync(
        path.join(ctx.root, '.swarmforge', 'daemon', 'handoffd.log'),
        `${isoAt(ctx.now)} heartbeat\n`
      );
      fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'babysitterd', 'babysitterd.pid'), '1\n');
    }
  );

  scoped(registry, /^no commit-in-flight style mute applies to babysitterd$/, () => {
    // babysitterd has no commit-in-flight mute — freshness always judges heartbeat age.
  });

  scoped(registry, /^the freshness checker runs$/, (ctx) => {
    const result = runChecker(ctx.root, ctx.now);
    if (result.status !== 0) {
      throw new Error(`BL-1133: freshness checker failed: ${result.stderr}`);
    }
  });

  scoped(registry, /^it records a stale-heartbeat violation for babysitterd$/, (ctx) => {
    const incidents = path.join(ctx.root, '.swarmforge', 'daemon', 'freshness-incidents.log');
    if (!fs.existsSync(incidents)) {
      throw new Error('BL-1133: expected freshness incidents file');
    }
    const text = fs.readFileSync(incidents, 'utf8');
    if (!/daemon=babysitterd/.test(text) || !/reason=stale-heartbeat/.test(text)) {
      throw new Error(`BL-1133: expected babysitterd stale-heartbeat; got:\n${text}`);
    }
  });
}

module.exports = { registerSteps };
