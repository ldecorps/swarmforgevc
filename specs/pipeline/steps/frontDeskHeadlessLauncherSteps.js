'use strict';

// BL-292: step handlers for "Telegram front desk runs headless - supervised
// bridge + Front Desk Bot". Drives the REAL launch_front_desk.sh (a real
// bridge process + a real bot process, fake Telegram credentials - the bot's
// own outbound Telegram calls are never exercised here, only the bridge
// side and the process-supervision wiring), and the REAL
// front_desk_supervisor.bb --check-once for the bounded-restart scenario
// (mirrors test_front_desk_supervisor_tick.sh's own fixture pattern). No
// live Telegram network anywhere - headless-frontdesk-05's own "principal
// posts a message" is proven via the REAL bridge's /telegram-inbound route
// (exactly what the real bot's own postToBridge call does once it decodes
// a real Telegram update), matching BL-281's own already-proven mechanism,
// since a real Telegram round-trip is explicitly a human-run integration
// step per this ticket's own QA e2e procedure, not something CI can drive.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, execSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const LAUNCHER = path.join(SCRIPTS_DIR, 'launch_front_desk.sh');
const SUPERVISOR_BB = path.join(SCRIPTS_DIR, 'front_desk_supervisor.bb');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');

const FAKE_TELEGRAM_ENV = { TELEGRAM_BOT_TOKEN: 'fake-bot-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_PRINCIPAL_USER_ID: '111' };

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-front-desk-headless-'));
}

function linkCompiledOut(root) {
  fs.mkdirSync(path.join(root, 'extension', 'out'), { recursive: true });
  fs.symlinkSync(path.join(EXT_OUT, 'tools'), path.join(root, 'extension', 'out', 'tools'));
  fs.symlinkSync(path.join(EXT_OUT, 'bridge'), path.join(root, 'extension', 'out', 'bridge'));
  fs.symlinkSync(path.join(EXT_OUT, 'notify'), path.join(root, 'extension', 'out', 'notify'));
  fs.symlinkSync(path.join(EXT_OUT, 'swarm'), path.join(root, 'extension', 'out', 'swarm'));
  fs.symlinkSync(path.join(EXT_OUT, 'panel'), path.join(root, 'extension', 'out', 'panel'));
  fs.symlinkSync(path.join(EXT_OUT, 'metrics'), path.join(root, 'extension', 'out', 'metrics'));
  fs.symlinkSync(path.join(EXT_OUT, 'docs'), path.join(root, 'extension', 'out', 'docs'));
  fs.symlinkSync(path.join(EXT_OUT, 'i18n'), path.join(root, 'extension', 'out', 'i18n'));
}

function freePort() {
  return 21000 + Math.floor(Math.random() * 9000);
}

function launch(root, port, env = {}) {
  // The launcher's own "already running" idempotency message (BL-292
  // headless-frontdesk-04) goes to stderr, not stdout - `2>&1` at the
  // shell level merges them so execFileSync's single stdout-only return
  // value carries it too.
  return execFileSync('bash', ['-c', `${LAUNCHER} "$1" 2>&1`, '--', root], {
    // A fast supervisor tick so a scenario's own stop-file cleanup (see
    // stopFrontDesk below) takes effect quickly rather than lingering up
    // to the real (2s) production default across the whole test run.
    encoding: 'utf8',
    env: { ...process.env, ...FAKE_TELEGRAM_ENV, BRIDGE_PORT: String(port), FRONT_DESK_INTERVAL_MS: '200', ...env },
  });
}

function readStatus(root) {
  const file = path.join(root, '.swarmforge', 'operator', 'front-desk-supervisor.status.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readBridgeToken(root) {
  return fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'bridge-token'), 'utf8');
}

function readSupervisorPid(root) {
  const file = path.join(root, '.swarmforge', 'operator', 'front-desk-supervisor.pid');
  return fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8').trim()) : null;
}

// Immediate, synchronous cleanup so a scenario never leaks its own spawned
// supervisor/bridge/bot processes onto the test host, and never leaves them
// alive to accumulate across the acceptance run - this pipeline framework
// has no per-scenario teardown hook, so each scenario's own terminal Then
// step calls this itself. Kills the pids DIRECTLY rather than only writing
// the stop-file and waiting out the supervisor's own poll interval - the
// stop-file is still written too (so a supervisor that outlives its
// children's kill signals still winds itself down), but the actual
// processes are gone before this function returns, not "soon".
function killPidsFromStatus(root) {
  const file = path.join(root, '.swarmforge', 'operator', 'front-desk-supervisor.status.json');
  if (fs.existsSync(file)) {
    const status = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of ['bridge', 'bot']) {
      const pid = status[key] && status[key].pid;
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already dead - fine, that's the point of cleanup
        }
      }
    }
  }
  const supervisorPid = readSupervisorPid(root);
  if (supervisorPid) {
    try {
      process.kill(supervisorPid, 'SIGKILL');
    } catch {
      // already dead
    }
  }
}

function stopFrontDesk(root) {
  const stopFile = path.join(root, '.swarmforge', 'operator', 'front-desk-supervisor.stop');
  fs.mkdirSync(path.dirname(stopFile), { recursive: true });
  fs.writeFileSync(stopFile, '');
  killPidsFromStatus(root);
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the front desk is launched headless with no VS Code host$/, () => {
    // Framing only - each scenario's own Given builds its own fixture.
  });

  // ── headless-frontdesk-01 ────────────────────────────────────────────
  registry.define(/^the headless launcher runs$/, (ctx) => {
    ctx.root = mkTmp();
    linkCompiledOut(ctx.root);
    ctx.port = freePort();
  });

  registry.define(/^it brings up the bridge$/, async (ctx) => {
    ctx.launchOutput = launch(ctx.root, ctx.port);
    ctx.token = readBridgeToken(ctx.root);
    ctx.up = await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${ctx.port}/pipeline`, { headers: { authorization: `Bearer ${ctx.token}` } });
        return res.status === 200;
      } catch {
        return false;
      }
    });
  });

  registry.define(/^the bridge serves the front-desk routes with a provisioned control token$/, async (ctx) => {
    if (!ctx.up) {
      throw new Error('expected the bridge to come up and serve an authorized read route');
    }
    // A control-scoped route (gate-answer) accepts the SAME provisioned
    // token as BOTH the bearer and the X-Control-Token step-up, proving a
    // real CONTROL token was provisioned, not just a read-only one.
    const res = await fetch(`http://127.0.0.1:${ctx.port}/telegram-inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.token}`, 'x-control-token': ctx.token },
      body: JSON.stringify({ subjectId: 'SUP-999-probe', channel: 'telegram', text: 'probe' }),
    });
    stopFrontDesk(ctx.root);
    if (res.status !== 200) {
      throw new Error(`expected the control-scoped route to accept the provisioned token, got status ${res.status}`);
    }
  });

  // ── headless-frontdesk-02 ────────────────────────────────────────────
  registry.define(/^the bridge is running with its provisioned tokens$/, async (ctx) => {
    ctx.root = mkTmp();
    linkCompiledOut(ctx.root);
    ctx.port = freePort();
    launch(ctx.root, ctx.port);
    ctx.token = readBridgeToken(ctx.root);
    await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${ctx.port}/pipeline`, { headers: { authorization: `Bearer ${ctx.token}` } });
        return res.status === 200;
      } catch {
        return false;
      }
    });
  });

  registry.define(/^the launcher brings up the Front Desk Bot$/, async (ctx) => {
    ctx.botUp = await waitFor(async () => {
      const status = readStatus(ctx.root);
      return status.bot && status.bot.status === 'running' && status.bot.pid;
    });
    ctx.status = readStatus(ctx.root);
  });

  registry.define(/^the bot runs against that bridge with the Telegram credentials and the bridge's tokens in its env$/, (ctx) => {
    if (!ctx.botUp) {
      throw new Error('expected the bot process to be running');
    }
    // Real verification of the LIVE process's own environment (not just
    // what the launcher intended to pass) - /proc/<pid>/environ.
    const environPath = `/proc/${ctx.status.bot.pid}/environ`;
    const environRaw = fs.readFileSync(environPath, 'utf8');
    const env = Object.fromEntries(
      environRaw
        .split('\0')
        .filter(Boolean)
        .map((entry) => {
          const idx = entry.indexOf('=');
          return [entry.slice(0, idx), entry.slice(idx + 1)];
        })
    );
    for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_PRINCIPAL_USER_ID', 'BRIDGE_TOKEN', 'BRIDGE_CONTROL_TOKEN']) {
      if (!env[key]) {
        throw new Error(`expected the bot process's own env to carry ${key}, got: ${JSON.stringify(Object.keys(env))}`);
      }
    }
    stopFrontDesk(ctx.root);
    if (env.BRIDGE_TOKEN !== ctx.token || env.BRIDGE_CONTROL_TOKEN !== ctx.token) {
      throw new Error('expected the bot to carry the SAME provisioned token as the bridge');
    }
  });

  // ── headless-frontdesk-03 ────────────────────────────────────────────

  // A fake fixture's bridge entrypoint never exits (setInterval forever,
  // mirroring the real bridge's own "stays up while healthy" contract) and
  // INHERITS its stdio from the bb process that spawned it
  // (:out :inherit :err :inherit, front_desk_supervisor.bb's own real
  // wiring). execFileSync's DEFAULT stdio is 'pipe' - it reads stdout/
  // stderr to EOF, which never arrives while that grandchild process is
  // still alive holding the pipe open, hanging the call forever (this bit
  // Node, not bash - launch_front_desk.sh's own `>> "$LOG" 2>&1`
  // redirection breaks this exact inheritance chain, which is why
  // launch()'s own execFileSync calls elsewhere in this file never hit it).
  // 'ignore' sidesteps it entirely - this call's own stdout was never used
  // for verification anyway (status.json is read separately).
  function checkOnce(root, env) {
    execFileSync('bb', [SUPERVISOR_BB, root, '--check-once'], { stdio: 'ignore', env });
  }

  registry.define(/^a supervised front-desk process that has crashed$/, (ctx) => {
    ctx.root = mkTmp();
    fs.mkdirSync(path.join(ctx.root, 'extension', 'out', 'tools'), { recursive: true });
    fs.writeFileSync(path.join(ctx.root, 'extension', 'out', 'tools', 'start-bridge-headless.js'), 'setInterval(() => {}, 1000);\n');
    // A bot that always crashes on start - this scenario is about the
    // SUPERVISOR's own reaction, not about a healthy process.
    fs.writeFileSync(path.join(ctx.root, 'extension', 'out', 'tools', 'telegram-front-desk-bot.js'), 'process.exit(1);\n');
    ctx.env = { ...process.env, BRIDGE_TOKEN: 'fake', ...FAKE_TELEGRAM_ENV, FRONT_DESK_MAX_ATTEMPTS: '2', FRONT_DESK_BACKOFF_BASE_MS: '10', FRONT_DESK_BACKOFF_MAX_MS: '20' };
    checkOnce(ctx.root, ctx.env);
  });

  registry.define(/^the supervisor reacts$/, async (ctx) => {
    // Bounded poll - never an unbounded wait - re-running --check-once
    // until the bot either gives up or a generous tick budget is spent.
    ctx.gaveUp = await waitFor(() => {
      checkOnce(ctx.root, ctx.env);
      return readStatus(ctx.root).bot.status === 'gave-up';
    }, 6000);
    ctx.finalStatus = readStatus(ctx.root);
  });

  registry.define(/^it restarts the process with backoff up to a bounded limit and then gives up$/, (ctx) => {
    killPidsFromStatus(ctx.root);
    if (!ctx.gaveUp) {
      throw new Error(`expected the bot to eventually give up after its bounded restart cap, got: ${JSON.stringify(ctx.finalStatus)}`);
    }
    if (ctx.finalStatus.bot.attempts !== 2) {
      throw new Error(`expected exactly 2 attempts (the configured cap), got: ${ctx.finalStatus.bot.attempts}`);
    }
  });

  // ── headless-frontdesk-04 ────────────────────────────────────────────
  registry.define(/^the front desk is already running$/, async (ctx) => {
    ctx.root = mkTmp();
    linkCompiledOut(ctx.root);
    ctx.port = freePort();
    launch(ctx.root, ctx.port);
    ctx.token = readBridgeToken(ctx.root);
    await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${ctx.port}/pipeline`, { headers: { authorization: `Bearer ${ctx.token}` } });
        return res.status === 200;
      } catch {
        return false;
      }
    });
    ctx.firstStatus = readStatus(ctx.root);
  });

  registry.define(/^the launcher is invoked a second time$/, (ctx) => {
    ctx.secondLaunchOutput = launch(ctx.root, ctx.port);
    ctx.secondStatus = readStatus(ctx.root);
  });

  registry.define(/^no second instance is started$/, (ctx) => {
    stopFrontDesk(ctx.root);
    if (!/already running/.test(ctx.secondLaunchOutput)) {
      throw new Error(`expected the second launch to report "already running", got: ${ctx.secondLaunchOutput}`);
    }
    if (ctx.secondStatus.bridge.pid !== ctx.firstStatus.bridge.pid || ctx.secondStatus.bot.pid !== ctx.firstStatus.bot.pid) {
      throw new Error('expected the SAME bridge/bot pids after a second launch - no second instance started');
    }
  });

  // ── headless-frontdesk-05 ────────────────────────────────────────────
  registry.define(/^the headless front desk is up$/, async (ctx) => {
    ctx.root = mkTmp();
    linkCompiledOut(ctx.root);
    ctx.port = freePort();
    launch(ctx.root, ctx.port);
    ctx.token = readBridgeToken(ctx.root);
    ctx.up = await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${ctx.port}/pipeline`, { headers: { authorization: `Bearer ${ctx.token}` } });
        return res.status === 200;
      } catch {
        return false;
      }
    });
  });

  registry.define(/^the principal posts a message in a subject topic$/, async (ctx) => {
    if (!ctx.up) {
      throw new Error('expected the headless front desk to be up before posting');
    }
    ctx.subjectId = 'SUP-1';
    ctx.text = 'my PR is stuck';
    ctx.postResult = await fetch(`http://127.0.0.1:${ctx.port}/telegram-inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.token}`, 'x-control-token': ctx.token },
      body: JSON.stringify({ subjectId: ctx.subjectId, channel: 'telegram', text: ctx.text }),
    });
  });

  registry.define(/^it lands as a SUP-### thread and the Operator replies in that topic$/, async (ctx) => {
    if (ctx.postResult.status !== 200) {
      throw new Error(`expected the inbound post to succeed, got status ${ctx.postResult.status}`);
    }
    const threadFile = path.join(ctx.root, '.swarmforge', 'support', 'threads', `${ctx.subjectId}.json`);
    const upLanded = await waitFor(async () => fs.existsSync(threadFile), 2000);
    if (!upLanded) {
      throw new Error('expected the inbound message to land as a SUP-### thread');
    }
    const thread = JSON.parse(fs.readFileSync(threadFile, 'utf8'));
    if (!thread.messages.some((m) => m.text === ctx.text)) {
      throw new Error(`expected the thread to carry the posted message, got: ${JSON.stringify(thread)}`);
    }
    // "The Operator replies in that topic" - reuses the SAME reply-outbox
    // -> SSE -> bot egress BL-281/BL-284 already proved works end to end;
    // here we prove the Operator's own reply path (operator_reply.bb)
    // reaches the SAME real bridge this launcher started.
    execSync(`bb "${path.join(SCRIPTS_DIR, 'operator_reply.bb')}" "${ctx.root}" --thread ${ctx.subjectId} --text "check the CI logs"`, { encoding: 'utf8' });
    const replied = await waitFor(async () => {
      const outboxFile = path.join(ctx.root, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
      if (!fs.existsSync(outboxFile)) {
        return false;
      }
      return fs
        .readFileSync(outboxFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .some((line) => JSON.parse(line).threadId === ctx.subjectId);
    }, 2000);
    stopFrontDesk(ctx.root);
    if (!replied) {
      throw new Error('expected the Operator reply to reach the reply outbox for this subject');
    }
  });
}

module.exports = { registerSteps };
