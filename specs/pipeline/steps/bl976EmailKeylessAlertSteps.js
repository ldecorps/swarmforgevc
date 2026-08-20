'use strict';

// BL-976: step handlers for "Daemon email capability survives relaunch or
// fails loudly to the operator". Two real surfaces, no live daemon and no
// real key anywhere:
//   - generation sweeps: bl976_email_keyless_harness.bb drives the REAL
//     daemon_alarm_lib.bb (email-send-reason / alert-keyless-if-needed! /
//     warn-missing-key-if-needed!) and briefing_email_lib.bb
//     (send-unsent-briefings!) with a recording fixture Telegram transport
//     and fixture email transport - wired exactly as handoffd.bb's own
//     email-keyless-alert-sweep! / briefing-send-reason! wire them.
//   - launch: the REAL start_handoff_daemon.sh against a scratch
//     WORKING_DIR through its existing HANDOFFD_BB/HANDOFFD_SUPERVISOR_BB
//     seams; the handoffd stub records key PRESENCE (never the value) plus
//     the real configured-email-send-reason verdict.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HARNESS = path.join(SCRIPTS, 'test', 'bl976_email_keyless_harness.bb');
const LAUNCHER = path.join(SCRIPTS, 'start_handoff_daemon.sh');
const ALARM_LIB = path.join(SCRIPTS, 'daemon_alarm_lib.bb');

const FEATURE = 'Daemon email capability survives relaunch or fails loudly to the operator';
const FILE_NAME = '2026-08-16.md';
const TODAY = '2026-08-16';
const DUMMY_KEY = 'bl976-acceptance-dummy-key-f0e1d2c3b4';

const HANDOFFD_STUB = `(require '[babashka.fs :as fs] '[clojure.string :as str])
(let [root (first *command-line-args*)
      daemon-dir (fs/path root ".swarmforge" "daemon")]
  (fs/create-dirs daemon-dir)
  (spit (str (fs/path daemon-dir "handoffd.pid"))
        (str (.pid (java.lang.ProcessHandle/current)))))
(load-file (System/getenv "BL976_ALARM_LIB"))
(let [key-present (not (str/blank? (System/getenv "RESEND_API_KEY")))
      verdict (daemon-alarm-lib/configured-email-send-reason
               (System/getenv "BL976_CONF_FILE"))]
  (spit (System/getenv "BL976_PROBE_FILE")
        (str "key_present=" (if key-present 1 0) "\\n"
             "verdict=" (pr-str verdict) "\\n")))
(Thread/sleep 5000)
`;

const SUPERVISOR_STUB = `(require '[babashka.fs :as fs])
(let [root (first *command-line-args*)
      daemon-dir (fs/path root ".swarmforge" "daemon")]
  (fs/create-dirs daemon-dir)
  (spit (str (fs/path daemon-dir "handoffd-supervisor.pid"))
        (str (.pid (java.lang.ProcessHandle/current)))))
(Thread/sleep 5000)
`;

function ensureBriefingsDir(ctx) {
  if (!ctx.briefingsDir) {
    ctx.briefingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl976-briefings-'));
  }
  return ctx.briefingsDir;
}

function ensureProjectRoot(ctx) {
  if (!ctx.projectRoot) {
    ctx.projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl976-root-'));
    ctx.envFilePath = path.join(ctx.projectRoot, '.swarmforge', 'operator', 'daemon.env');
    ctx.confFile = path.join(ctx.projectRoot, 'swarmforge.conf');
    fs.writeFileSync(ctx.confFile, 'config notify_email_to operator@example.com\n');
  }
  return ctx.projectRoot;
}

function envFilePathFor(ctx) {
  // Every scenario asserts against the path the launch path looks for -
  // scenarios that never launch still name the same shape.
  return ctx.envFilePath || path.join(ensureProjectRoot(ctx), '.swarmforge', 'operator', 'daemon.env');
}

function runGeneration(ctx, keyState, sweeps) {
  const args = [HARNESS, ensureBriefingsDir(ctx), 'generation', keyState, String(sweeps), envFilePathFor(ctx), TODAY];
  const out = execFileSync('bb', args, { encoding: 'utf8' });
  ctx.result = JSON.parse(out);
  ctx.harnessRawOut = out;
  return ctx.result;
}

function launchDaemon(ctx) {
  ensureProjectRoot(ctx);
  ctx.stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl976-stubs-'));
  fs.writeFileSync(path.join(ctx.stubDir, 'handoffd_stub.bb'), HANDOFFD_STUB);
  fs.writeFileSync(path.join(ctx.stubDir, 'supervisor_stub.bb'), SUPERVISOR_STUB);
  ctx.probeFile = path.join(ctx.projectRoot, 'probe');

  const env = { ...process.env };
  delete env.RESEND_API_KEY; // the launch SHELL is keyless in every scenario
  delete env.SWARMFORGE_CONFIG;
  env.HANDOFFD_BB = path.join(ctx.stubDir, 'handoffd_stub.bb');
  env.HANDOFFD_SUPERVISOR_BB = path.join(ctx.stubDir, 'supervisor_stub.bb');
  env.BL976_ALARM_LIB = ALARM_LIB;
  env.BL976_CONF_FILE = ctx.confFile;
  env.BL976_PROBE_FILE = ctx.probeFile;

  const res = spawnSync('bash', [LAUNCHER, ctx.projectRoot], { encoding: 'utf8', env, timeout: 30000 });
  ctx.launchStatus = res.status;
  ctx.launchOut = `${res.stdout || ''}${res.stderr || ''}`;

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (fs.existsSync(ctx.probeFile) && fs.statSync(ctx.probeFile).size > 0) break;
  }
  ctx.probe = fs.existsSync(ctx.probeFile) ? fs.readFileSync(ctx.probeFile, 'utf8') : '';
  ctx.generationKeyed = /^key_present=1$/m.test(ctx.probe);

  for (const pidFile of ['handoffd.pid', 'handoffd-supervisor.pid']) {
    const p = path.join(ctx.projectRoot, '.swarmforge', 'daemon', pidFile);
    if (fs.existsSync(p)) {
      const pid = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
      if (Number.isInteger(pid)) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      }
    }
  }
}

function cleanup(ctx) {
  for (const key of ['briefingsDir', 'projectRoot', 'stubDir']) {
    if (ctx[key]) {
      fs.rmSync(ctx[key], { recursive: true, force: true });
      ctx[key] = null;
    }
  }
}

function assertSkippedNotSent(ctx) {
  const skips = ctx.result.logs.filter((l) => l[0] === 'briefing-skip-missing-key' && l[1] === FILE_NAME);
  if (skips.length < 1) {
    throw new Error(`expected a briefing-skip-missing-key line for ${FILE_NAME}, logs: ${JSON.stringify(ctx.result.logs)}`);
  }
  if (ctx.result.emailsSent !== 0) {
    throw new Error(`expected no email sent, got emailsSent=${ctx.result.emailsSent}`);
  }
  const marker = path.join(ctx.briefingsDir, '.sent.json');
  if (fs.existsSync(marker)) {
    throw new Error(`expected no .sent.json marker, found: ${fs.readFileSync(marker, 'utf8')}`);
  }
}

function assertExactlyOneAlert(ctx) {
  if (ctx.result.telegramAlerts.length !== 1) {
    throw new Error(`expected exactly one Telegram keyless alert, got ${ctx.result.telegramAlerts.length}: ${JSON.stringify(ctx.result.telegramAlerts)}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a conf with notify_email_to configured$/, (ctx) => {
    // The generation harness hardcodes a configured recipient; launch
    // scenarios get a real fixture conf via ensureProjectRoot.
    ensureProjectRoot(ctx);
  });

  scoped(/^a fixture briefings directory with one unsent in-window briefing$/, (ctx) => {
    fs.writeFileSync(path.join(ensureBriefingsDir(ctx), FILE_NAME), 'Headline: BL-976 acceptance fixture\n\nBody.\n');
  });

  // ── Givens ────────────────────────────────────────────────────────────
  scoped(/^a daemon environment with no RESEND_API_KEY$/, (ctx) => {
    ctx.keyState = 'keyless';
  });

  scoped(/^an operator env file defining RESEND_API_KEY$/, (ctx) => {
    ensureProjectRoot(ctx);
    fs.mkdirSync(path.dirname(ctx.envFilePath), { recursive: true });
    fs.writeFileSync(ctx.envFilePath, `RESEND_API_KEY=${DUMMY_KEY}\n`);
  });

  scoped(/^a launch shell environment with no RESEND_API_KEY$/, () => {
    // Marker only: launchDaemon always strips RESEND_API_KEY from the
    // launcher's environment - the ambient shell is keyless by
    // construction in every launch scenario.
  });

  scoped(/^no operator env file exists$/, (ctx) => {
    ensureProjectRoot(ctx);
    if (fs.existsSync(ctx.envFilePath)) fs.rmSync(ctx.envFilePath);
  });

  scoped(/^a briefing skipped by a keyless daemon generation$/, (ctx) => {
    runGeneration(ctx, 'keyless', 1);
    assertSkippedNotSent(ctx);
  });

  scoped(/^the briefing is still within the send window$/, () => {
    // Marker: every harness call passes today-str equal to the briefing's
    // own date, so the fixture briefing is in-window by construction.
  });

  // ── Whens ─────────────────────────────────────────────────────────────
  scoped(/^the first briefing sweep of the daemon generation runs$/, (ctx) => {
    const keyState = ctx.keyState || (ctx.generationKeyed ? 'keyed' : 'keyless');
    runGeneration(ctx, keyState, 1);
  });

  scoped(/^three consecutive briefing sweeps of the same daemon generation run$/, (ctx) => {
    runGeneration(ctx, ctx.keyState || 'keyless', 3);
  });

  scoped(/^the daemon is launched through the standard launch script$/, (ctx) => {
    launchDaemon(ctx);
  });

  scoped(/^a later daemon generation runs with RESEND_API_KEY present$/, (ctx) => {
    // Two sweeps, one generation: proves the send happens AND is not
    // repeated by the very next cycle.
    runGeneration(ctx, 'keyed', 2);
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  // Cleanup discipline (no scenario-end hook exists in this runtime): the
  // TERMINAL Then of each scenario cleans up in a finally; steps that are
  // terminal in one scenario but mid-scenario in another discriminate on
  // whether a launch happened (ctx.launchStatus set) - unique per shape:
  //   01/02 end on skipped-not-sent (no launch), 03 on sweep-sends (launch),
  //   04 on exactly-one-alert (launch), 05 on no-log-line, 06 on
  //   recorded-sent-once. Every step still cleans up on its own failure.
  const launched = (ctx) => ctx.launchStatus !== undefined;

  scoped(/^exactly one keyless-email alert is delivered through the Telegram operator transport$/, (ctx) => {
    try {
      assertExactlyOneAlert(ctx);
      if (launched(ctx)) cleanup(ctx); // terminal in scenario 04
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the alert names RESEND_API_KEY and the env file the launch path looks for$/, (ctx) => {
    try {
      const text = ctx.result.telegramAlerts[0] || '';
      if (!text.includes('RESEND_API_KEY')) {
        throw new Error(`alert must name RESEND_API_KEY, got: ${text}`);
      }
      if (!text.includes(envFilePathFor(ctx))) {
        throw new Error(`alert must name the env file path ${envFilePathFor(ctx)}, got: ${text}`);
      }
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the briefing is skipped, not treated as sent$/, (ctx) => {
    try {
      // Scenario 04 has no explicit sweep When - the launched (keyless)
      // generation's first sweep runs here, off the launch probe's own
      // key observation.
      if (!ctx.result) {
        runGeneration(ctx, ctx.generationKeyed ? 'keyed' : 'keyless', 1);
      }
      assertSkippedNotSent(ctx);
      if (!launched(ctx)) cleanup(ctx); // terminal in scenarios 01/02
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the daemon's email-capability decision sees the key$/, (ctx) => {
    try {
      if (!/^key_present=1$/m.test(ctx.probe)) {
        throw new Error(`expected the generation to see the key, probe: ${ctx.probe}; launch: ${ctx.launchOut}`);
      }
      if (!/^verdict=nil$/m.test(ctx.probe)) {
        throw new Error(`expected a sendable verdict from the real decision, probe: ${ctx.probe}`);
      }
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the briefing sweep sends the unsent briefing through the fixture email transport$/, (ctx) => {
    try {
      if (!ctx.result) {
        // Scenario 03 reaches here right after a launch, no sweep yet -
        // run the keyed generation sweep the step asserts on. Scenario
        // 06's keyed generation already ran; a failing 06 must never be
        // masked by a fresh re-run here.
        runGeneration(ctx, 'keyed', 1);
      }
      if (ctx.result.emailsSent !== 1) {
        throw new Error(`expected exactly one email through the fixture transport, got ${ctx.result.emailsSent}`);
      }
      if (launched(ctx)) cleanup(ctx); // terminal in scenario 03
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the launch completes without error$/, (ctx) => {
    try {
      if (ctx.launchStatus !== 0) {
        throw new Error(`expected launch exit 0, got ${ctx.launchStatus}: ${ctx.launchOut}`);
      }
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^no log line produced by launch or sweep contains the key's value$/, (ctx) => {
    try {
      const hits = [];
      const scan = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) scan(p);
          else if (p !== ctx.envFilePath && fs.readFileSync(p, 'utf8').includes(DUMMY_KEY)) hits.push(p);
        }
      };
      scan(ctx.projectRoot);
      if ((ctx.harnessRawOut || '').includes(DUMMY_KEY)) hits.push('(harness output)');
      if ((ctx.launchOut || '').includes(DUMMY_KEY)) hits.push('(launcher output)');
      if (hits.length) {
        throw new Error(`key value leaked into: ${hits.join(', ')}`);
      }
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the briefing is recorded as sent exactly once$/, (ctx) => {
    try {
      const sentLogs = ctx.result.logs.filter((l) => l[0] === 'briefing-sent' && l[1] === FILE_NAME);
      if (sentLogs.length !== 1 || ctx.result.emailsSent !== 1) {
        throw new Error(`expected exactly one send across the keyed generation's sweeps, logs: ${JSON.stringify(ctx.result.logs)}, emailsSent: ${ctx.result.emailsSent}`);
      }
      const marker = path.join(ctx.briefingsDir, '.sent.json');
      if (!fs.existsSync(marker) || !fs.readFileSync(marker, 'utf8').includes(FILE_NAME)) {
        throw new Error(`expected ${FILE_NAME} recorded in .sent.json`);
      }
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
