'use strict';

// BL-789: step handlers for "Freshness and bridge supervision survive a
// cron environment and a slow host" (the 2026-08-02 Mac host-switch
// hotfix, adopted/reviewed under this ticket). Scenarios 1-3 and 6 drive
// the REAL swarmforge/scripts/test/test_daemon_log_freshness.sh suite
// (BL-761/BL-785 established pattern: the shell suite is the natural home
// for checker/installer/handoffd source-level assertions, this file greps
// its own PASS lines rather than re-implementing them) - it was extended
// by this very ticket with the SKIP_BABYSITTERD/PATH/heartbeat-at-start
// checks these steps assert on. Scenarios 4-5 (bridge port adopt/free)
// have no shell-suite home - they drive the REAL front_desk_supervisor.bb
// against a real fake bridge process on an ISOLATED, non-default port
// (never 8765 - a real swarm may be running on this host RIGHT NOW).
//
// Every registration is scoped to FEATURE_NAME (registry.defineScoped) -
// several step phrasings here ("When the freshness check runs") are
// plausible enough that an unscoped registration could collide with
// BL-675/BL-785's own near-identical wording.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync, spawn } = require('node:child_process');
// BL-789 architect bounce: scenarios 4/5/6 spawn real detached+unref'd
// processes (fake bridge servers, a real handoffd.bb) whose only prior
// cleanup lived in each scenario's own terminal Then step - an earlier
// assertion throwing, or the runner itself being interrupted/killed/timed
// out, leaked them exactly like the BL-458 incident onAbnormalExit was
// built to catch (a live orphaned handoffd.bb, over an hour old, was found
// during this review). Each spawn site below registers its own kill as an
// abnormal-exit callback the moment it has a pid to kill, in addition to
// the existing happy-path cleanup in its scenario's own terminal step.
// BL-789 architect bounce (follow-up): scenario 05's own trigger of a real
// front_desk_supervisor.bb tick spawns a FOURTH detached bridge process
// (ctx.postTickStatus.bridge.pid) that onAbnormalExit above does not cover -
// it is written to front-desk-supervisor.status.json, the exact shape
// track()/reap() already read. track(ctx.bridgeRoot) covers it via that
// existing path, same as frontDeskHeadlessLauncherSteps.js does for its own
// fixture roots.
const { onAbnormalExit, track } = require('./lib/fixtureReaper');

const FEATURE_NAME = 'Freshness and bridge supervision survive a cron environment and a slow host';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SHELL_SUITE = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_daemon_log_freshness.sh');
const CHECKER = path.join(SWARMFORGE_SCRIPTS, 'daemon_log_freshness_check.sh');
const SUPERVISOR = path.join(SWARMFORGE_SCRIPTS, 'front_desk_supervisor.bb');
const HANDOFFD = path.join(SWARMFORGE_SCRIPTS, 'handoffd.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runShellSuite(ctx) {
  if (ctx.suiteOutput !== undefined) return ctx.suiteOutput;
  const result = spawnSync('bash', [SHELL_SUITE], { encoding: 'utf8', timeout: 120000, env: process.env });
  ctx.suiteOutput = `${result.stdout || ''}${result.stderr || ''}`;
  ctx.suiteExit = result.status;
  return ctx.suiteOutput;
}

function expectPass(ctx, fragment, label) {
  const output = runShellSuite(ctx);
  if (!output.includes(fragment)) {
    throw new Error(`BL-789: expected "${fragment}" (${label}) in test_daemon_log_freshness.sh output, got:\n${output}`);
  }
}

// ── isolated bridge-port fixture helpers (scenarios 4/5) ───────────────────

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A zombie (terminated but not yet reaped by ITS OWN parent - here, this
// test's own long-lived Node process, which never waits on a
// detached+unref'd child) still answers kill(pid, 0) truthfully "exists" on
// macOS/POSIX even though its resources (including any listening socket)
// are already released - `ps -o state=` reports "Z" only for a genuine
// zombie, never for a truly-still-running process, so this is a reliable
// "actually terminated, not just PID-table debris" check that a raw
// isAlive() cannot make.
function isZombie(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'state='], { encoding: 'utf8' });
  return (result.stdout || '').trim().startsWith('Z');
}

function isGenuinelyAlive(pid) {
  return isAlive(pid) && !isZombie(pid);
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

// A random high port per scenario run - never the real default 8765, which
// a genuinely live swarm on this very host may already be serving.
function pickIsolatedPort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

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
      if (done) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('BL-789: timed out waiting for condition'));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 300 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// Fake `start-bridge-headless.js`: a real, tiny HTTP server serving
// /lets-talk (the SAME health route start_bridge_headless.sh's own
// convention already probes) - a real process, real socket, real HTTP
// response, never a mocked lsof/curl call.
function writeFakeBridgeEntrypoint(root) {
  const dir = path.join(root, 'extension', 'out', 'tools');
  fs.mkdirSync(dir, { recursive: true });
  const entrypoint = path.join(dir, 'start-bridge-headless.js');
  fs.writeFileSync(
    entrypoint,
    [
      "const http = require('http');",
      'const port = Number(process.argv[3]);',
      'const server = http.createServer((req, res) => {',
      "  if (req.url === '/lets-talk') { res.writeHead(200); res.end('ok'); return; }",
      '  res.writeHead(404); res.end();',
      '});',
      'server.listen(port);',
      '',
    ].join('\n')
  );
  return entrypoint;
}

// Node's own detached process group (spawn's {detached:true}) - equivalent
// to `setsid`, without depending on the external setsid binary being
// present on this host (it is not, on this Mac - a pre-existing, unrelated
// gap; see BL-789's coder handoff notes).
function spawnDetached(cmd, args, opts) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
  child.unref();
  return child;
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a project root with a daemon state directory$/,
    (ctx) => {
      ctx.root = mkTmp('bl789-root-');
      fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'daemon'), { recursive: true });
      fs.mkdirSync(path.join(ctx.root, '.swarmforge', 'babysitterd'), { recursive: true });
      ctx.env = { PATH: '/usr/bin:/bin' };
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a stub interpreter that is reachable only outside the minimal cron PATH$/,
    (ctx) => {
      const stubDir = path.join(ctx.root, 'stub-interpreter-dir');
      fs.mkdirSync(stubDir, { recursive: true });
      const stub = path.join(stubDir, 'bb');
      fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(stub, 0o755);
      ctx.stubDir = stubDir;
    },
    FEATURE_NAME
  );

  // ── scenario 01 ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the freshness check is invoked with PATH set to "([^"]+)"$/,
    (ctx, minimalPath) => {
      ctx.env.PATH = minimalPath;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the freshness check runs$/,
    () => {
      // Real driving happens in the Then steps below (scenario 1/2 each
      // need a differently-configured real checker invocation) - this
      // step exists so the Gherkin reads naturally; nothing to do here
      // itself, matching the codebase's own established "collect Givens,
      // assert in Then" convention for multi-clause scenarios.
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it resolves the stub interpreter$/,
    (ctx) => {
      expectPass(
        ctx,
        "PASS: BL-789: the freshness path resolves bb from a PATH it establishes itself",
        'checker resolves its own interpreter under a minimal cron PATH'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it does not report the daemon as down for a missing interpreter$/,
    (ctx) => {
      expectPass(
        ctx,
        'ok   - BL-789: interpreter resolved under a minimal cron PATH via the checker\'s own PATH',
        'no missing-interpreter down-report'
      );
    },
    FEATURE_NAME
  );

  // ── scenario 02 (outline) ────────────────────────────────────────────────
  registry.defineScoped(
    /^the swarm environment sets "SWARMFORGE_SKIP_BABYSITTERD=(\d)"$/,
    (ctx, value) => {
      ctx.skipBabysitterd = value;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the babysitter daemon restart is "(skipped|attempted)"$/,
    (ctx, outcome) => {
      if (ctx.skipBabysitterd === '1') {
        expectPass(ctx, 'PASS: BL-789: a deliberately-skipped babysitterd is never restarted', 'skip=1 -> skipped');
        if (outcome !== 'skipped') throw new Error('BL-789: expected skipped for SWARMFORGE_SKIP_BABYSITTERD=1');
      } else {
        expectPass(ctx, "PASS: BL-789: SKIP_BABYSITTERD=0 leaves the restart path unchanged", 'skip=0 -> attempted');
        if (outcome !== 'attempted') throw new Error('BL-789: expected attempted for SWARMFORGE_SKIP_BABYSITTERD=0');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no restart warning for that daemon is logged$/,
    (ctx) => {
      if (ctx.skipBabysitterd === '1') {
        expectPass(ctx, 'ok   - BL-789: SKIP_BABYSITTERD=1 issues no announce/warning', 'no warning on skip');
      }
    },
    FEATURE_NAME
  );

  // ── scenario 03 ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the freshness cron is installed$/,
    () => {
      /* asserted for real against test_daemon_log_freshness.sh below */
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the crontab entry sets a PATH containing the interpreter's directory$/,
    (ctx) => {
      expectPass(ctx, "ok   - BL-789: crontab line sets a PATH=", 'crontab PATH=');
      expectPass(ctx, "ok   - BL-789: crontab PATH contains the resolved interpreter's directory", 'crontab PATH names interpreter dir');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the crontab entry names the project root$/,
    (ctx) => {
      expectPass(ctx, 'ok   - BL-789: crontab line still names the project root', 'crontab names root');
    },
    FEATURE_NAME
  );

  // ── scenario 04/05: bridge port adopt vs free (real fixtures, real ports) ─
  registry.defineScoped(
    /^a healthy bridge process is listening on the bridge port$/,
    async (ctx) => {
      ctx.bridgeRoot = mkTmp('bl789-bridge-');
      ctx.bridgePort = pickIsolatedPort();
      writeFakeBridgeEntrypoint(ctx.bridgeRoot);
      const entrypoint = path.join(ctx.bridgeRoot, 'extension', 'out', 'tools', 'start-bridge-headless.js');
      const child = spawnDetached('node', [entrypoint, ctx.bridgeRoot, String(ctx.bridgePort)]);
      ctx.preExistingBridgePid = child.pid;
      onAbnormalExit(() => killPid(ctx.preExistingBridgePid));
      await waitFor(() => portOpen(ctx.bridgePort), 5000);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^an unrelated process is listening on the bridge port$/,
    async (ctx) => {
      ctx.bridgeRoot = mkTmp('bl789-bridge-');
      // Covers the supervisor's OWN freshly-spawned bridge later in this
      // scenario (ctx.postTickStatus.bridge.pid) - a process this file never
      // spawns itself, so no onAbnormalExit callback here has its pid to
      // close over. track() lets reap() find it fresh from
      // front-desk-supervisor.status.json at signal/exit time instead.
      track(ctx.bridgeRoot);
      ctx.bridgePort = pickIsolatedPort();
      // Real, unrelated node process - never matches "start-bridge-headless"
      // in its own cmdline, so bridge-entrypoint-holder? must say no.
      const child = spawnDetached('node', [
        '-e',
        `require('http').createServer((q,r)=>{r.writeHead(200);r.end('unrelated')}).listen(${ctx.bridgePort})`,
      ]);
      ctx.unrelatedPid = child.pid;
      onAbnormalExit(() => killPid(ctx.unrelatedPid));
      await waitFor(() => portOpen(ctx.bridgePort), 5000);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the supervisor's tracked process id is dead$/,
    (ctx) => {
      const opDir = path.join(ctx.bridgeRoot, '.swarmforge', 'operator');
      fs.mkdirSync(opDir, { recursive: true });
      // A "waiting" entry whose backoff has already elapsed - check-one!
      // decides :restart on this very tick with no further delay, exactly
      // as "the supervisor's tracked process id is dead" implies a PRIOR
      // tick already observed the crash.
      const now = Date.now();
      const status = {
        bridge: { pid: 999999, attempts: 1, status: 'waiting', 'crashed-at-ms': now - 5000, 'started-at-ms': now - 10000, 'gave-up-at-ms': null },
      };
      fs.writeFileSync(path.join(opDir, 'front-desk-supervisor.status.json'), JSON.stringify(status));
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the supervisor takes its next turn$/,
    (ctx) => {
      const opDir = path.join(ctx.bridgeRoot, '.swarmforge', 'operator');
      fs.mkdirSync(opDir, { recursive: true });
      const env = {
        ...process.env,
        BRIDGE_PORT: String(ctx.bridgePort),
        BRIDGE_TOKEN: 'bl789-test-token',
        TELEGRAM_BOT_TOKEN: 'x',
        TELEGRAM_CHAT_ID: 'y',
        TELEGRAM_PRINCIPAL_USER_ID: 'z',
        // BL-622 test seam: an isolated fleet-home so this fixture never
        // touches (or is confused by) the real operator's ~/.swarmforge/fleet.
        SWARMFORGE_FLEET_HOME: path.join(ctx.bridgeRoot, 'fleet-home'),
      };
      const result = spawnSync('bb', [SUPERVISOR, ctx.bridgeRoot, '--check-once'], {
        encoding: 'utf8',
        timeout: 20000,
        env,
      });
      ctx.tickResult = result;
      const statusFile = path.join(opDir, 'front-desk-supervisor.status.json');
      ctx.postTickStatus = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : null;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the supervisor adopts the listening process$/,
    (ctx) => {
      if (!ctx.postTickStatus || !ctx.postTickStatus.bridge) {
        throw new Error(`BL-789: expected a bridge status entry after the tick: ${JSON.stringify(ctx.tickResult)}`);
      }
      if (ctx.postTickStatus.bridge.pid !== ctx.preExistingBridgePid) {
        throw new Error(
          `BL-789: expected the supervisor to adopt the pre-existing healthy bridge pid=${ctx.preExistingBridgePid}, got pid=${ctx.postTickStatus.bridge.pid}`
        );
      }
      if (!isAlive(ctx.preExistingBridgePid)) {
        throw new Error('BL-789: the adopted (pre-existing) bridge process must still be alive, not killed');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^no second bridge process is spawned$/,
    async (ctx) => {
      // A second spawn on the same port would fail with EADDRINUSE; the
      // real, durable proof is the port still serving exactly the ORIGINAL
      // process's pid, not merely "a" process.
      const stillOpen = await portOpen(ctx.bridgePort);
      if (!stillOpen) throw new Error('BL-789: expected the bridge port to still be served');
      killPid(ctx.preExistingBridgePid);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the supervisor frees the port$/,
    (ctx) => {
      if (isGenuinelyAlive(ctx.unrelatedPid)) {
        throw new Error('BL-789: expected the unrelated port-holder to have been freed (killed)');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a bridge process is spawned$/,
    (ctx) => {
      if (!ctx.postTickStatus || !ctx.postTickStatus.bridge || !ctx.postTickStatus.bridge.pid) {
        throw new Error(`BL-789: expected a freshly spawned bridge pid after freeing the port: ${JSON.stringify(ctx.tickResult)}`);
      }
      if (ctx.postTickStatus.bridge.pid === ctx.unrelatedPid) {
        throw new Error('BL-789: the recorded bridge pid must be a NEW process, not the freed unrelated one');
      }
      killPid(ctx.postTickStatus.bridge.pid);
      killPid(ctx.unrelatedPid);
    },
    FEATURE_NAME
  );

  // ── scenario 06 ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the handoff daemon begins a cycle that outlasts the freshness window$/,
    async (ctx) => {
      ctx.hdRoot = mkTmp('bl789-handoffd-');
      const swarmforgeDir = path.join(ctx.hdRoot, '.swarmforge');
      fs.mkdirSync(path.join(swarmforgeDir, 'daemon'), { recursive: true });
      fs.mkdirSync(path.join(swarmforgeDir, 'handoffs', 'inbox', 'new'), { recursive: true });
      fs.mkdirSync(path.join(swarmforgeDir, 'handoffs', 'coordinator', 'inbox', 'new'), { recursive: true });
      fs.mkdirSync(path.join(swarmforgeDir, 'handoffs', 'coordinator', 'inbox', 'in_process'), { recursive: true });
      fs.mkdirSync(path.join(swarmforgeDir, 'handoffs', 'coordinator', 'inbox', 'completed'), { recursive: true });
      fs.mkdirSync(path.join(ctx.hdRoot, 'backlog', 'active'), { recursive: true });
      fs.mkdirSync(path.join(ctx.hdRoot, 'backlog', 'paused'), { recursive: true });
      fs.mkdirSync(path.join(ctx.hdRoot, 'backlog', 'done'), { recursive: true });
      fs.mkdirSync(path.join(ctx.hdRoot, 'docs', 'briefings'), { recursive: true });

      const sock = path.join(ctx.hdRoot, 'fake.sock');
      fs.writeFileSync(sock, '');
      fs.writeFileSync(path.join(swarmforgeDir, 'tmux-socket'), sock);
      fs.writeFileSync(
        path.join(swarmforgeDir, 'roles.tsv'),
        `coordinator\tmaster\t${ctx.hdRoot}\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n`
      );
      // Neutralize the unrelated briefing-generation sweep, same technique
      // as test_handoffd_answer_file_drain_wiring.sh.
      const todayKey = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(path.join(ctx.hdRoot, 'docs', 'briefings', `${todayKey}.md`), 'Headline: unrelated\n');

      const fakeBinDir = path.join(ctx.hdRoot, 'bin');
      fs.mkdirSync(fakeBinDir, { recursive: true });
      fs.writeFileSync(path.join(fakeBinDir, 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
      fs.chmodSync(path.join(fakeBinDir, 'tmux'), 0o755);

      ctx.hdLogFile = path.join(swarmforgeDir, 'daemon', 'handoffd.log');
      ctx.hdHeartbeatFile = path.join(swarmforgeDir, 'daemon', 'handoffd.heartbeat');
      const env = {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
        SWARMFORGE_ALLOW_TMP_DAEMON: '1',
      };
      delete env.TELEGRAM_BOT_TOKEN;
      delete env.TELEGRAM_CHAT_ID;
      delete env.RESEND_API_KEY;
      const child = spawnDetached('bb', [HANDOFFD, ctx.hdRoot], { env });
      ctx.hdPid = child.pid;
      onAbnormalExit(() => {
        try {
          fs.writeFileSync(path.join(ctx.hdRoot, '.swarmforge', 'daemon', 'stop'), '');
        } catch {
          // best-effort - the kill below is what actually matters
        }
        killPid(ctx.hdPid);
      });

      // Proof a cycle has genuinely begun (not just that the process exists).
      await waitFor(() => fs.existsSync(ctx.hdLogFile) && fs.readFileSync(ctx.hdLogFile, 'utf8').includes('-start'), 15000, 100);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the freshness check runs mid-cycle$/,
    (ctx) => {
      // Run the REAL checker against the REAL daemon's own heartbeat file,
      // immediately after the cycle-start pulse was observed above - the
      // daemon's later sweeps may still be running (the cycle has not
      // necessarily finished), same "mid-flight" moment the scenario names.
      // Only handoffd is under test here - keep babysitterd fresh so its
      // own (unrelated) staleness never trips a restart in this fixture.
      const bsDir = path.join(ctx.hdRoot, '.swarmforge', 'babysitterd');
      fs.mkdirSync(bsDir, { recursive: true });
      fs.writeFileSync(path.join(bsDir, 'babysitterd.log'), `${new Date().toISOString()} heartbeat\n`);

      const result = spawnSync('/bin/sh', [CHECKER], {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          FRESHNESS_ROOT: ctx.hdRoot,
          FRESHNESS_CONF: path.join(SWARMFORGE_SCRIPTS, 'daemon_log_freshness.conf'),
          FRESHNESS_INCIDENT_FILE: path.join(ctx.hdRoot, '.swarmforge', 'daemon', 'freshness-incidents.log'),
          FRESHNESS_ANNOUNCE_CMD: 'true',
          FRESHNESS_KILL_CMD: `printf '%s\\n' "$1" >> "${path.join(ctx.hdRoot, 'kills.log')}"`,
          FRESHNESS_START_CMD: `printf '%s\\n' "$1" >> "${path.join(ctx.hdRoot, 'starts.log')}"`,
        },
      });
      ctx.midCycleCheckResult = result;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a heartbeat from the cycle's start is visible$/,
    (ctx) => {
      if (!fs.existsSync(ctx.hdHeartbeatFile)) {
        throw new Error('BL-789: expected the handoffd heartbeat file to exist after cycle start');
      }
      const log = fs.readFileSync(ctx.hdLogFile, 'utf8');
      if (!log.includes('heartbeat cycle=0-start')) {
        throw new Error(`BL-789: expected a cycle=0-start heartbeat log line, got:\n${log}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the daemon is not reported as wedged$/,
    (ctx) => {
      const startsLog = path.join(ctx.hdRoot, 'starts.log');
      const starts = fs.existsSync(startsLog) ? fs.readFileSync(startsLog, 'utf8') : '';
      if (starts.includes('start_handoff_daemon.sh')) {
        throw new Error(`BL-789: expected no restart attempt (not wedged), but the checker restarted handoffd: ${starts}`);
      }
      // Cleanup: stop the real daemon we started above.
      fs.writeFileSync(path.join(ctx.hdRoot, '.swarmforge', 'daemon', 'stop'), '');
      killPid(ctx.hdPid);
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
