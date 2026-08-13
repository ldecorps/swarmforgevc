'use strict';

// BL-763: step handlers for "Stamp hand Bubble tunnel revive fixes (meta
// bounce + always-on path)". Three domains, each driven at the narrowest
// real level available:
//  - meta-01/meta-02 (extension bridge): the REAL startBridge() HTTP
//    server, real fetch() calls (same posture bridgeServer.test.js's own
//    integration tests use).
//  - session-01 (Bubble/Android bounce decision) and boundary-01 (the
//    pre-existing BL-716 host/DNS classification, untouched by this
//    ticket): per the Testability Boundary — Bubble, driven through the
//    REAL `gradlew :app:testDebugUnitTest` (specs/pipeline/steps/lib/androidGradle.js,
//    the BL-769 seam BL-864's own step file already established).
//  - lifecycle-01/lifecycle-02 (ancillary scripts): the REAL
//    start_ancillary_services.sh / stop_ancillary_services.sh /
//    stop_cursor_bridge.sh, against fixture roots, a fake supervisor
//    process standing in for the real one (same posture
//    test_start_ancillary_services_cursor_bridge_gate.sh uses).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { runGradle, readJUnitResults } = require('./lib/androidGradle');

const FEATURE_NAME = 'Stamp hand Bubble tunnel revive fixes (meta bounce + always-on path)';
const TEST_REPORT_DIR = 'testDebugUnitTest';
const TOKEN = 'bl763-acceptance-token';

function repoRoot() {
  return path.join(__dirname, '..', '..', '..');
}

function bridgeServerModule() {
  return require(path.join(repoRoot(), 'extension', 'out', 'bridge', 'bridgeServer'));
}

function mkTargetDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bl763-acceptance-'));
}

const BL763_TICKET_FILENAME = 'BL-763-bubble-tunnel-hand-fixes-swarm-stamp.yaml';

// The ticket starts in backlog/active/ but may have moved to
// backlog/done/<milestone>/ by the time this acceptance run happens.
function readBl763TicketSource() {
  const activePath = path.join(repoRoot(), 'backlog', 'active', BL763_TICKET_FILENAME);
  if (fs.existsSync(activePath)) {
    return fs.readFileSync(activePath, 'utf8');
  }
  const doneRoot = path.join(repoRoot(), 'backlog', 'done');
  const found = fs.existsSync(doneRoot)
    ? fs.readdirSync(doneRoot, { recursive: true }).find((f) => String(f).endsWith(BL763_TICKET_FILENAME))
    : null;
  if (!found) {
    throw new Error(`could not locate ${BL763_TICKET_FILENAME} under backlog/active/ or ${doneRoot}`);
  }
  return fs.readFileSync(path.join(doneRoot, found), 'utf8');
}

async function fetchMeta(port) {
  const res = await fetch(`http://127.0.0.1:${port}/lets-talk/meta`, {
    headers: { authorization: `Bearer ${TOKEN}`, 'x-control-token': TOKEN },
  });
  const body = await res.json();
  return { status: res.status, body };
}

function runJvmSuite(ctx) {
  if (ctx.jvmResult) {
    return; // one gradlew run serves every step within a scenario.
  }
  ctx.androidDir = path.join(repoRoot(), 'android');
  ctx.jvmResult = runGradle(repoRoot(), [':app:testDebugUnitTest', '--console=plain']);
  ctx.junitResults = readJUnitResults(ctx.androidDir, TEST_REPORT_DIR);
}

function assertKnownTestPassed(ctx, classSubstring, nameSubstring, describeFor) {
  if (ctx.jvmResult.status !== 0) {
    throw new Error(
      `expected gradlew :app:testDebugUnitTest to exit 0 for "${describeFor}", got ${ctx.jvmResult.status}. output:\n` +
        `${ctx.jvmResult.stdout}\n${ctx.jvmResult.stderr}`
    );
  }
  const matches = ctx.junitResults.filter(
    (r) => r.classname.includes(classSubstring) && r.name.includes(nameSubstring)
  );
  if (matches.length === 0) {
    throw new Error(
      `expected a passed test in ${classSubstring} naming "${nameSubstring}" for "${describeFor}", ` +
        `found none among: ${JSON.stringify(ctx.junitResults)}`
    );
  }
  if (matches.some((r) => !r.passed)) {
    throw new Error(`expected the matching test(s) for "${describeFor}" to have passed: ${JSON.stringify(matches)}`);
  }
}

// ── lifecycle fixture helpers (mirrors test_start_ancillary_services_cursor_bridge_gate.sh) ──

function mkScriptsFixture() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bl763-lifecycle-'));
  const scriptsDir = path.join(d, 'swarmforge', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(path.join(d, '.swarmforge', 'operator'), { recursive: true });
  const src = path.join(repoRoot(), 'swarmforge', 'scripts');
  for (const name of ['start_ancillary_services.sh', 'stop_ancillary_services.sh', 'stop_cursor_bridge.sh']) {
    fs.copyFileSync(path.join(src, name), path.join(scriptsDir, name));
    fs.chmodSync(path.join(scriptsDir, name), 0o755);
  }
  return d;
}

function pidFilePath(root) {
  return path.join(root, '.swarmforge', 'operator', 'cursor-bridge-supervisor.pid');
}

function spawnFakeSupervisor(root) {
  const child = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
  child.unref();
  fs.writeFileSync(pidFilePath(root), String(child.pid));
  return child.pid;
}

// A plain `process.kill(pid, 0)` reports a ZOMBIE as alive - the fake
// supervisor here is a Node-spawned child, so once stop_cursor_bridge.sh
// (an unrelated process) kills it, it stays a zombie until THIS process's
// event loop reaps it, which a synchronous spawnSync call for the script
// itself never yields to. `ps -o stat=` reading 'Z' is the actually-dead
// check that does not depend on winning that reap race.
function pidAlive(pid) {
  const res = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  const stat = (res.stdout || '').trim();
  return stat.length > 0 && !stat.startsWith('Z');
}

function markerPath(root) {
  return path.join(root, 'cursor-bridge-started.marker');
}

function installFakeCursorBridgeStart(root) {
  const scriptsDir = path.join(root, 'swarmforge', 'scripts');
  const marker = markerPath(root);
  fs.writeFileSync(
    path.join(scriptsDir, 'start_cursor_bridge.sh'),
    `#!/usr/bin/env bash\necho "$$" > "${marker}"\nexit 0\n`
  );
  fs.chmodSync(path.join(scriptsDir, 'start_cursor_bridge.sh'), 0o755);
}

// SKIP_ENV mirrors the shell tests' own isolation - every ancillary except
// cursor bridge is skipped, and a present-but-empty $HOME/.zshenv sidesteps
// the bash-3.2 `source <missing> || true` gotcha the shell tests already
// document, without leaking a live operator host's real Telegram secrets.
function runAncillaryScript(root, scriptName, extraEnv) {
  const homeEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'bl763-home-'));
  fs.writeFileSync(path.join(homeEmpty, '.zshenv'), '');
  const env = {
    HOME: homeEmpty,
    PATH: process.env.PATH,
    SWARMFORGE_SKIP_OPERATOR: '1',
    SWARMFORGE_SKIP_FRONT_DESK: '1',
    SWARMFORGE_SKIP_ONBOARDER: '1',
    SWARMFORGE_SKIP_BABYSITTERD: '1',
    SWARMFORGE_SKIP_FRESHNESS_CRON: '1',
    SWARMFORGE_SKIP_TUNNEL: '1',
    SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL: '1',
    ...extraEnv,
  };
  return spawnSync('bash', [path.join(root, 'swarmforge', 'scripts', scriptName), root], { env, encoding: 'utf8' });
}

function registerSteps(registry) {
  // ── meta-01 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a headless Let's Talk bridge is listening$/,
    async (ctx) => {
      const { startBridge } = bridgeServerModule();
      ctx.target = mkTargetDir();
      ctx.handle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN, {});
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a client GETs \/lets-talk\/meta$/,
    async (ctx) => {
      ctx.metaResponse = await fetchMeta(ctx.handle.port);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the response is JSON with a non-empty instanceId$/,
    (ctx) => {
      if (ctx.metaResponse.status !== 200) {
        throw new Error(`expected HTTP 200, got ${ctx.metaResponse.status}`);
      }
      const { instanceId } = ctx.metaResponse.body;
      if (typeof instanceId !== 'string' || instanceId.length === 0) {
        throw new Error(`expected a non-empty instanceId, got ${JSON.stringify(ctx.metaResponse.body)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a subsequent GET against the same process returns the same instanceId$/,
    async (ctx) => {
      const second = await fetchMeta(ctx.handle.port);
      if (second.body.instanceId !== ctx.metaResponse.body.instanceId) {
        throw new Error(
          `expected the same instanceId, got ${second.body.instanceId} vs ${ctx.metaResponse.body.instanceId}`
        );
      }
      ctx.handle.stop();
    },
    FEATURE_NAME
  );

  // ── meta-02 ──────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a client has observed instanceId A from \/lets-talk\/meta$/,
    async (ctx) => {
      const { startBridge } = bridgeServerModule();
      ctx.target = mkTargetDir();
      ctx.firstHandle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN, {});
      const { body } = await fetchMeta(ctx.firstHandle.port);
      ctx.instanceIdA = body.instanceId;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the bridge process is restarted and becomes healthy again$/,
    async (ctx) => {
      ctx.firstHandle.stop();
      const { startBridge } = bridgeServerModule();
      ctx.secondHandle = await startBridge(ctx.target, path.join(ctx.target, 'runs.jsonl'), TOKEN, {});
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the client GETs \/lets-talk\/meta$/,
    async (ctx) => {
      ctx.metaResponse = await fetchMeta(ctx.secondHandle.port);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the response instanceId is not A$/,
    (ctx) => {
      if (ctx.metaResponse.body.instanceId === ctx.instanceIdA) {
        throw new Error(`expected a different instanceId from A=${ctx.instanceIdA}, got the same value`);
      }
      ctx.secondHandle.stop();
    },
    FEATURE_NAME
  );

  // ── session-01 (Bubble/Android, JVM unit suite) ─────────────────────
  registry.defineScoped(/^Bubble has stored a previous bridge instanceId$/, () => {}, FEATURE_NAME);
  registry.defineScoped(/^remote config enables bridge bounce auto session reset$/, () => {}, FEATURE_NAME);

  registry.defineScoped(
    /^\/lets-talk\/meta reports a different instanceId$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^Bubble calls \/lets-talk\/new-session once for that change$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'BridgeBounceSessionTest',
        'a changed instanceId with auto-reset enabled resets the session',
        'Bubble calls /lets-talk/new-session once for that change'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it does not call new-session again while the instanceId stays the same$/,
    (ctx) => {
      assertKnownTestPassed(
        ctx,
        'BridgeBounceSessionTest',
        'an unchanged instanceId never resets the session, even with auto-reset enabled',
        'it does not call new-session again while the instanceId stays the same'
      );
    },
    FEATURE_NAME
  );

  // ── lifecycle-01 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^the Cursor Remote bridge supervisor is running$/,
    (ctx) => {
      ctx.lifecycleRoot = mkScriptsFixture();
      ctx.supervisorPid = spawnFakeSupervisor(ctx.lifecycleRoot);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^stop_ancillary_services\.sh completes$/,
    (ctx) => {
      ctx.stopResult = runAncillaryScript(ctx.lifecycleRoot, 'stop_ancillary_services.sh', {});
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the Cursor Remote bridge supervisor is still running$/,
    (ctx) => {
      if (!pidAlive(ctx.supervisorPid)) {
        throw new Error(
          `expected cursor-bridge supervisor pid ${ctx.supervisorPid} to still be alive after stop_ancillary_services.sh ` +
            `(exit=${ctx.stopResult.status}); stdout:\n${ctx.stopResult.stdout}\nstderr:\n${ctx.stopResult.stderr}`
        );
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^an explicit stop_cursor_bridge\.sh is required to tear it down$/,
    (ctx) => {
      const res = spawnSync(
        'bash',
        [path.join(ctx.lifecycleRoot, 'swarmforge', 'scripts', 'stop_cursor_bridge.sh'), ctx.lifecycleRoot],
        { encoding: 'utf8' }
      );
      if (res.status !== 0) {
        throw new Error(`expected stop_cursor_bridge.sh to exit 0, got ${res.status}: ${res.stdout}\n${res.stderr}`);
      }
      if (pidAlive(ctx.supervisorPid)) {
        throw new Error(`expected explicit stop_cursor_bridge.sh to terminate pid ${ctx.supervisorPid}`);
      }
    },
    FEATURE_NAME
  );

  // ── lifecycle-02 ─────────────────────────────────────────────────────
  registry.defineScoped(
    /^Cursor Remote bridge is not running$/,
    (ctx) => {
      ctx.lifecycleRoot = mkScriptsFixture();
      installFakeCursorBridgeStart(ctx.lifecycleRoot);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^Telegram \/ Cursor bridge credentials are configured$/,
    (ctx) => {
      ctx.credsEnv = {
        CURSOR_BRIDGE_BOT_TOKEN: 'x',
        TELEGRAM_CHAT_ID: 'x',
        TELEGRAM_PRINCIPAL_USER_ID: 'x',
      };
    },
    FEATURE_NAME
  );

  registry.defineScoped(/^SWARMFORGE_SKIP_CURSOR_BRIDGE is unset$/, () => {}, FEATURE_NAME);

  registry.defineScoped(
    /^start_ancillary_services\.sh runs$/,
    (ctx) => {
      ctx.startResult = runAncillaryScript(ctx.lifecycleRoot, 'start_ancillary_services.sh', ctx.credsEnv);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the Cursor Remote bridge supervisor is started$/,
    (ctx) => {
      if (!fs.existsSync(markerPath(ctx.lifecycleRoot))) {
        throw new Error(
          `expected start_cursor_bridge.sh to run (exit=${ctx.startResult.status}); ` +
            `stdout:\n${ctx.startResult.stdout}\nstderr:\n${ctx.startResult.stderr}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── boundary-01 ──────────────────────────────────────────────────────
  registry.defineScoped(/^a phone still paired to a dead trycloudflare hostname$/, () => {}, FEATURE_NAME);

  registry.defineScoped(
    /^a Let's Talk turn is attempted$/,
    (ctx) => {
      runJvmSuite(ctx);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the failure remains a host or DNS class error$/,
    (ctx) => {
      // BL-716's own classification (pre-existing, untouched by BL-763):
      // an unresolvable host reads as a stale-pairing connection failure,
      // never as success and never rewritten to claim the tunnel is fixed.
      assertKnownTestPassed(
        ctx,
        'BridgeClientTest',
        'classifies an unresolvable host as a stale-pairing connection failure',
        'the failure remains a host or DNS class error'
      );
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^fixing it still requires BL-716 discovery or manual re-pair$/,
    () => {
      const ticketSource = readBl763TicketSource();
      if (!/BL-716/.test(ticketSource)) {
        throw new Error("expected BL-763's own ticket to name BL-716 as the still-open discovery gap");
      }
      if (/BL-716[^\n]*\b(closed|fixed|resolved|done)\b/i.test(ticketSource)) {
        throw new Error("BL-763's own ticket must never claim BL-716 fixed/closed by assertion");
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
