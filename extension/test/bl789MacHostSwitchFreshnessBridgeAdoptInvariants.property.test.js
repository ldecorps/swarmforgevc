'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-789 invariants (property authorship rests with the coder, first pass -
// BL-654). Drives the REAL daemon_log_freshness_check.sh / handoffd.bb
// against real filesystem fixtures - never a parallel reimplementation.
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECKER = path.join(SWARMFORGE_SCRIPTS, 'daemon_log_freshness_check.sh');
const HANDOFFD = path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb');
const CONF = path.join(SWARMFORGE_SCRIPTS, 'daemon_log_freshness.conf');

function makeRoot() {
  const root = mkTmpDir('bl789-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'babysitterd'), { recursive: true });
  return root;
}

function isoTimestamp(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
}

function runChecker(root, { now, env = {} }) {
  return spawnSync('/bin/sh', [CHECKER], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      FRESHNESS_ROOT: root,
      FRESHNESS_CONF: CONF,
      FRESHNESS_NOW_EPOCH: String(now),
      FRESHNESS_INCIDENT_FILE: path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
      FRESHNESS_ANNOUNCE_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'announces.log')}"`,
      FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'kills.log')}"`,
      FRESHNESS_START_CMD: `printf '%s\\n' "$1" >> "${path.join(root, 'starts.log')}"`,
      ...env,
    },
  });
}

function noSideEffects(root) {
  return (
    !fs.existsSync(path.join(root, 'kills.log')) &&
    !fs.existsSync(path.join(root, 'starts.log')) &&
    (!fs.existsSync(path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log')) ||
      fs.statSync(path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log')).size === 0) &&
    !fs.existsSync(path.join(root, 'announces.log'))
  );
}

// ── Invariant 1 ──────────────────────────────────────────────────────────
// "A daemon the operator has deliberately disabled is never restarted by
// the freshness path, however often that path runs."
//
// Generator reach: crosses staleness from barely-stale to wildly stale
// (up to ~28 hours past threshold) - a regression that only special-cased
// "moderately stale" would still pass at the low end - and crosses run
// count 1-5, proving "however often" holds across REPEATED invocations
// against the SAME fixture, not just a first check.
const staleSecondsArb = fc.integer({ min: 601, max: 100000 }); // babysitterd threshold is 600s
const runCountArb = fc.integer({ min: 1, max: 5 });

test('property (invariant 1): a deliberately-skipped babysitterd is never restarted, however often the checker runs', () => {
  fc.assert(
    fc.property(staleSecondsArb, runCountArb, (staleSeconds, runCount) => {
      const root = makeRoot();
      const now = 1700000000;
      fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.log'), `${isoTimestamp(now)} heartbeat\n`);
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.log'),
        `${isoTimestamp(now - staleSeconds)} heartbeat\n`
      );
      fs.writeFileSync(path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.pid'), '999999\n');

      for (let i = 0; i < runCount; i += 1) {
        const result = runChecker(root, { now, env: { SWARMFORGE_SKIP_BABYSITTERD: '1' } });
        assert.equal(result.status, 0, `checker run ${i + 1} exited nonzero: ${result.stderr}`);
      }

      assert.equal(
        noSideEffects(root),
        true,
        `expected no restart/kill/announce/incident after ${runCount} run(s) at staleSeconds=${staleSeconds}`
      );
    }),
    { numRuns: 15 }
  );
});

// ── Invariant 2 ──────────────────────────────────────────────────────────
// "The freshness path resolves every binary it invokes from a PATH it
// establishes itself, never from whatever PATH its caller happened to
// have."
//
// Generator reach: crosses realistic hostile caller PATH shapes that all
// retain /usr/bin:/bin (so the script can still bootstrap itself via
// dirname/cd/pwd - core POSIX utils any real invoker, cron included, has)
// but never contain the stub interpreter's own directory, in different
// positions/paddings - the checker must resolve the stub via its OWN
// FRESHNESS_EXTRA_PATH_DIRS-established PATH regardless of where (or
// whether) the caller's own PATH noise sits. A totally EMPTY PATH, or one
// missing /usr/bin:/bin entirely, is deliberately excluded: even
// dirname/cd/pwd (needed to locate the script itself, before any
// PATH-fixing code can run at all) become unresolvable - a pre-existing
// POSIX-sh bootstrap constraint confirmed present with or without this
// ticket's changes, not a "caller PATH" scenario cron (or any real
// invoker) actually produces.
const callerPathArb = fc.constantFrom(
  '/usr/bin:/bin',
  '/nonexistent-dir-xyz:/usr/bin:/bin',
  '/usr/bin:/bin:/nonexistent-dir-xyz:/also-nonexistent',
  '/usr/bin:/nonexistent-dir-xyz:/bin'
);

test('property (invariant 2): the checker resolves its interpreter from its OWN PATH regardless of the caller PATH', () => {
  fc.assert(
    fc.property(callerPathArb, (callerPath) => {
      const root = makeRoot();
      const stubDir = path.join(root, 'stub-interpreter-dir');
      fs.mkdirSync(stubDir, { recursive: true });
      const stub = path.join(stubDir, 'bb');
      fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(stub, 0o755);

      const now = 1700000000;
      // Stale enough to force a restart attempt (so FRESHNESS_START_CMD runs
      // and can observe the checker's own resolved PATH).
      fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.log'), `${isoTimestamp(now - 200)} heartbeat\n`);
      fs.writeFileSync(path.join(root, '.swarmforge', 'babysitterd', 'babysitterd.log'), `${isoTimestamp(now)} heartbeat\n`);
      fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd.pid'), '999999\n');

      const resolvedLog = path.join(root, 'resolved-bb.log');
      const result = spawnSync('/bin/sh', [CHECKER], {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: callerPath,
          FRESHNESS_EXTRA_PATH_DIRS: stubDir,
          FRESHNESS_ROOT: root,
          FRESHNESS_CONF: CONF,
          FRESHNESS_NOW_EPOCH: String(now),
          FRESHNESS_INCIDENT_FILE: path.join(root, '.swarmforge', 'daemon', 'freshness-incidents.log'),
          FRESHNESS_ANNOUNCE_CMD: 'true',
          FRESHNESS_KILL_CMD: 'true',
          FRESHNESS_START_CMD: `command -v bb >> "${resolvedLog}" 2>&1 || true`,
        },
      });
      assert.equal(result.status, 0, `checker exited nonzero with caller PATH="${callerPath}": ${result.stderr}`);
      assert.equal(fs.existsSync(resolvedLog), true, `expected the restart attempt to have run at all (caller PATH="${callerPath}")`);
      const resolved = fs.readFileSync(resolvedLog, 'utf8');
      assert.equal(resolved.includes(stub), true, `expected bb resolved as "${stub}" regardless of caller PATH="${callerPath}", got: ${resolved}`);
    }),
    { numRuns: 12 }
  );
});

// ── Invariant 3 ──────────────────────────────────────────────────────────
// "A liveness heartbeat is emitted before long work as well as after it, so
// a slow cycle is never indistinguishable from a wedged one."
//
// Generator reach: crosses how many cycle-start pulses to wait for (1-3) -
// a regression that emitted a start-of-cycle heartbeat only on the FIRST
// cycle (e.g. a one-shot init write mistaken for the per-cycle fix) would
// pass at cycleCount=1 but fail once cycleCount>1 demands a SECOND
// (or third) fresh "-start" line.
function waitFor(predicate, timeoutMs, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      let done;
      try {
        done = predicate();
      } catch (e) {
        reject(e);
        return;
      }
      if (done) return resolve();
      if (Date.now() > deadline) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function killPid(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

const cycleCountArb = fc.integer({ min: 1, max: 3 });

test(
  'property (invariant 3): handoffd emits a heartbeat at the START of every cycle, not only its end',
  async () => {
    await fc.assert(
      fc.asyncProperty(cycleCountArb, async (cycleCount) => {
        const root = mkTmpDir('bl789-hd-prop-');
        const swarmforgeDir = path.join(root, '.swarmforge');
        fs.mkdirSync(path.join(swarmforgeDir, 'daemon'), { recursive: true });
        fs.mkdirSync(path.join(swarmforgeDir, 'handoffs', 'inbox', 'new'), { recursive: true });
        fs.mkdirSync(path.join(swarmforgeDir, 'handoffs', 'coordinator', 'inbox', 'new'), { recursive: true });
        fs.mkdirSync(path.join(swarmforgeDir, 'handoffs', 'coordinator', 'inbox', 'in_process'), { recursive: true });
        fs.mkdirSync(path.join(swarmforgeDir, 'handoffs', 'coordinator', 'inbox', 'completed'), { recursive: true });
        fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
        fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
        fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
        fs.mkdirSync(path.join(root, 'docs', 'briefings'), { recursive: true });

        const sock = path.join(swarmforgeDir, 'fake.sock');
        fs.writeFileSync(sock, '');
        fs.writeFileSync(path.join(swarmforgeDir, 'tmux-socket'), sock);
        fs.writeFileSync(path.join(swarmforgeDir, 'roles.tsv'), `coordinator\tmaster\t${root}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`);
        const todayKey = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(path.join(root, 'docs', 'briefings', `${todayKey}.md`), 'Headline: unrelated\n');

        const fakeBinDir = path.join(root, 'bin');
        fs.mkdirSync(fakeBinDir, { recursive: true });
        fs.writeFileSync(path.join(fakeBinDir, 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
        fs.chmodSync(path.join(fakeBinDir, 'tmux'), 0o755);

        const logFile = path.join(swarmforgeDir, 'daemon', 'handoffd.log');
        const env = { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}`, SWARMFORGE_ALLOW_TMP_DAEMON: '1' };
        delete env.TELEGRAM_BOT_TOKEN;
        delete env.TELEGRAM_CHAT_ID;
        delete env.RESEND_API_KEY;
        const child = spawn('bb', [HANDOFFD, root], { detached: true, stdio: 'ignore', env });
        child.unref();

        try {
          await waitFor(() => {
            if (!fs.existsSync(logFile)) return false;
            const log = fs.readFileSync(logFile, 'utf8');
            const startCount = (log.match(/heartbeat cycle=\d+-start/g) || []).length;
            return startCount >= cycleCount;
          }, 20000, 100);

          const log = fs.readFileSync(logFile, 'utf8');
          const startCount = (log.match(/heartbeat cycle=\d+-start/g) || []).length;
          assert.ok(startCount >= cycleCount, `expected >= ${cycleCount} cycle-start heartbeats, got ${startCount}:\n${log}`);
        } finally {
          fs.writeFileSync(path.join(swarmforgeDir, 'daemon', 'stop'), '');
          killPid(child.pid);
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 3 }
    );
  },
  60000
);
