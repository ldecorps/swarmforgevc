'use strict';

// BL-461: step handlers for "start-swarm and ensure bring the full stack up,
// pass the swarm gates, and are documented". This ticket forces a Cursor-side
// patch (swarm_ensure.bb covering operator + front desk, swarmforge.sh's
// start_ancillary_services, start-swarm.sh's post-launch `./swarm ensure`)
// through the swarm's OWN hard gates - Cursor-green is explicitly called out
// in the ticket as insufficient.
//
// Scenarios 02/03/04 drive the REAL swarm_ensure.bb against a private,
// disposable fixture (fake tmux/extension/daemon/operator/front-desk probes
// and repairs, injected via its own SWARM_ENSURE_*_CMD env seams) - the same
// posture test_swarm_ensure.sh already proves at the shell-gate layer,
// exercised here a second, independent way per bl460's own precedent (never
// a hand-rolled reimplementation of the decision logic itself, which stays
// in swarm_ensure.bb's pure `classify`).
//
// Scenario 01 is a STRUCTURAL proof of start-swarm.sh/swarmforge.sh's
// source, not a real tmux swarm launch: spinning up a genuine tmux
// session/socket here would risk exactly the "LIVE shared runtime path" the
// engineering rules warn a test must never touch (this repo's OWN swarm may
// be running on the real socket). The real end-to-end proof on an installed
// host is the ticket's own "E2E QA PROCEDURE", owned by QA.
//
// Scenario 05 re-runs the actual shell gate (test_swarm_ensure.sh) plus a
// syntax check of the touched scripts as a real subprocess - this IS the
// swarm's own hard gate, not a description of it.
//
// Scenario 06 (docs) checks real doc content and will legitimately stay red
// until the documenter's pass for this ticket lands; it is written now so
// the registry resolves every step and the check is real once that pass
// completes, per BL-112 (add step handlers now; QA still owns the final
// acceptance run).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARM_ENSURE = path.join(SCRIPTS_DIR, 'swarm_ensure.bb');
const START_SWARM_SH = path.join(REPO_ROOT, 'start-swarm.sh');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const TEST_SWARM_ENSURE_SH = path.join(SCRIPTS_DIR, 'test', 'test_swarm_ensure.sh');

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const TELEGRAM_ENV_VALUES = { set: true, unset: false };
function knownTelegramEnv(value) {
  if (!Object.prototype.hasOwnProperty.call(TELEGRAM_ENV_VALUES, value)) {
    throw new Error(`bl461 start-swarm-ensure: unrecognized <telegram_env> example value "${value}"`);
  }
  return TELEGRAM_ENV_VALUES[value];
}
const PRIOR_PID_VALUES = { present: true, absent: false };
function knownPriorPid(value) {
  if (!Object.prototype.hasOwnProperty.call(PRIOR_PID_VALUES, value)) {
    throw new Error(`bl461 start-swarm-ensure: unrecognized <prior_pid> example value "${value}"`);
  }
  return PRIOR_PID_VALUES[value];
}
const FRONT_DESK_VALUES = { checked: true, omitted: false };
function knownFrontDesk(value) {
  if (!Object.prototype.hasOwnProperty.call(FRONT_DESK_VALUES, value)) {
    throw new Error(`bl461 start-swarm-ensure: unrecognized <front_desk> example value "${value}"`);
  }
  return FRONT_DESK_VALUES[value];
}

function writeExec(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

// Mirrors test_swarm_ensure.sh's make_fixture(): a private, disposable root
// with fake tmux/extension/daemon/operator/front-desk probes and repairs,
// everything healthy by default (this process's own pid stands in for a
// live tracked process, same convention the shell fixture uses).
function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl461-ensure-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.worktrees', 'coder'), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });

  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), `${path.join(root, 'fake.sock')}\n`);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `coder\tcoder\t${path.join(root, '.worktrees', 'coder')}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const paneDeadFile = path.join(root, 'pane_dead');
  fs.writeFileSync(paneDeadFile, '0\n');
  writeExec(
    path.join(bin, 'tmux'),
    `#!/usr/bin/env bash\nif [[ "$3" == "list-panes" ]]; then\n  cat "${paneDeadFile}"\n  exit 0\nfi\nif [[ "$3" == "respawn-pane" ]]; then\n  echo "0" > "${paneDeadFile}"\n  exit 0\nfi\nexit 0\n`
  );

  const extStateFile = path.join(root, 'ext_state');
  fs.writeFileSync(extStateFile, 'healthy\n');
  writeExec(
    path.join(bin, 'fake_ext_check.sh'),
    `#!/usr/bin/env bash\n[[ "$(cat "${extStateFile}")" == "healthy" ]] && exit 0 || exit 1\n`
  );
  writeExec(path.join(bin, 'fake_ext_bounce.sh'), `#!/usr/bin/env bash\necho "healthy" > "${extStateFile}"\nexit 0\n`);

  const daemonPidFile = path.join(root, '.swarmforge', 'daemon', 'handoffd.pid');
  fs.writeFileSync(daemonPidFile, `${process.pid}\n`);
  const daemonLog = path.join(root, 'fake-daemon.log');
  writeExec(
    path.join(bin, 'fake_supervisor.bb'),
    `#!/usr/bin/env bb\n(require '[babashka.process :as process] '[babashka.fs :as fs])\n(def p (process/process ["sleep" "100"] {:out :append :out-file (fs/file "${daemonLog}") :err :append :err-file (fs/file "${daemonLog}")}))\n(spit "${daemonPidFile}" (str (.pid (:proc p))))\n`
  );

  const operatorPidFile = path.join(root, '.swarmforge', 'operator', 'runtime.pid');
  fs.writeFileSync(operatorPidFile, `${process.pid}\n`);
  const operatorLog = path.join(root, 'fake-operator.log');
  writeExec(
    path.join(bin, 'fake_operator_start.sh'),
    `#!/usr/bin/env bash\nsleep 100 >"${operatorLog}" 2>&1 &\necho $! > "${operatorPidFile}"\n`
  );

  const frontDeskPidFile = path.join(root, '.swarmforge', 'operator', 'front-desk-supervisor.pid');
  const frontDeskLog = path.join(root, 'fake-front-desk.log');
  writeExec(
    path.join(bin, 'fake_front_desk_start.sh'),
    `#!/usr/bin/env bash\nsleep 100 >"${frontDeskLog}" 2>&1 &\necho $! > "${frontDeskPidFile}"\n`
  );

  return { root, bin, paneDeadFile, extStateFile, daemonPidFile, operatorPidFile, frontDeskPidFile };
}

const TELEGRAM_ENV_VARS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_PRINCIPAL_USER_ID'];
const SKIP_FLAG_VARS = ['SWARMFORGE_SKIP_OPERATOR', 'SWARMFORGE_SKIP_FRONT_DESK'];

// Runs the real swarm_ensure.bb against `fixture`, scrubbing ambient
// Telegram creds / skip flags unless the caller explicitly provides them via
// extraEnv - the same guard-fires discipline test_swarm_ensure.sh's own
// make_fixture() now applies (a dev box routinely has real TELEGRAM_BOT_TOKEN
// et al. exported).
function runEnsure(fixture, extraEnv = {}) {
  const env = {
    ...process.env,
    PATH: `${fixture.bin}:${process.env.PATH}`,
    SWARM_ENSURE_EXTENSION_CHECK_CMD: path.join(fixture.bin, 'fake_ext_check.sh'),
    SWARM_ENSURE_EXTENSION_BOUNCE_CMD: path.join(fixture.bin, 'fake_ext_bounce.sh'),
    SWARM_ENSURE_SUPERVISOR_CMD: `bb ${path.join(fixture.bin, 'fake_supervisor.bb')}`,
    SWARM_ENSURE_OPERATOR_CMD: path.join(fixture.bin, 'fake_operator_start.sh'),
    SWARM_ENSURE_FRONT_DESK_CMD: path.join(fixture.bin, 'fake_front_desk_start.sh'),
    ...extraEnv,
  };
  for (const name of [...TELEGRAM_ENV_VARS, ...SKIP_FLAG_VARS]) {
    if (!Object.prototype.hasOwnProperty.call(extraEnv, name)) {
      delete env[name];
    }
  }
  try {
    const stdout = execFileSync('bb', [SWARM_ENSURE, fixture.root], { encoding: 'utf8', env });
    return { stdout, status: 0 };
  } catch (err) {
    return { stdout: (err.stdout || '') + (err.stderr || ''), status: err.status ?? 1 };
  }
}

function cleanupFixture(fixture) {
  if (!fixture) return;
  for (const pidFile of [fixture.daemonPidFile, fixture.operatorPidFile, fixture.frontDeskPidFile]) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isInteger(pid) && pid !== process.pid) {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // no pid file, unparseable, or already dead - nothing to clean up.
    }
  }
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function registerSteps(registry) {
  // ── start-swarm-ensure-01 (structural: see file header) ─────────────────
  registry.define(/^a host with the Telegram front-desk env configured$/, (ctx) => {
    ctx.telegramConfiguredHost = true;
  });

  registry.define(/^\.\/start-swarm\.sh runs$/, (ctx) => {
    ctx.startSwarmSource = fs.readFileSync(START_SWARM_SH, 'utf8');
    ctx.swarmforgeShSource = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  });

  registry.define(/^the agent sessions are up$/, (ctx) => {
    if (!ctx.startSwarmSource.includes('wait_for_ready "$WANT"')) {
      throw new Error('expected start-swarm.sh to wait for the agent sessions to be ready before continuing');
    }
  });

  registry.define(/^the handoff daemon, operator runtime, and front-desk supervisor are up$/, (ctx) => {
    if (!ctx.startSwarmSource.includes('"$TARGET/swarm" ensure "$TARGET"')) {
      throw new Error('expected start-swarm.sh to run "./swarm ensure" after sessions are ready');
    }
    // The repair/start behaviour itself (daemon/operator/front-desk each
    // brought to HEALTHY/FIXED) is proven directly, not structurally, by
    // scenario 02 below. Here: the cold-launch path also starts them
    // proactively, not relying on the post-launch repair pass alone.
    if (!ctx.swarmforgeShSource.includes('start_ancillary_services')) {
      throw new Error('expected swarmforge.sh cold launch to call start_ancillary_services');
    }
    if (!ctx.swarmforgeShSource.includes('start_handoff_daemon')) {
      throw new Error('expected swarmforge.sh cold launch to start the handoff daemon');
    }
  });

  registry.define(/^any ancillary that fails to start is reported failed without aborting the agent launch$/, (ctx) => {
    const ensureBlock = ctx.startSwarmSource.match(/if ! "\$TARGET\/swarm" ensure "\$TARGET"; then([\s\S]*?)\nfi/);
    if (!ensureBlock) {
      throw new Error('expected to find the best-effort "./swarm ensure" block in start-swarm.sh');
    }
    if (!ensureBlock[1].includes('WARNING: ./swarm ensure reported failures')) {
      throw new Error('expected a failed "./swarm ensure" to be reported as a warning');
    }
    if (ensureBlock[1].includes('exit')) {
      throw new Error(`expected a failed "./swarm ensure" to warn without aborting start-swarm.sh, got block: ${ensureBlock[1]}`);
    }
    if (!ctx.swarmforgeShSource.includes("Operator runtime failed to start; run './swarm ensure'")) {
      throw new Error('expected a failed operator start during cold launch to warn, not abort the launch');
    }
    if (!ctx.swarmforgeShSource.includes("Front desk failed to start; run './swarm ensure'")) {
      throw new Error('expected a failed front-desk start during cold launch to warn, not abort the launch');
    }
  });

  // ── start-swarm-ensure-02 ─────────────────────────────────────────────────
  registry.define(/^the BL-145 ensure behaviour for agents and the handoff daemon$/, (ctx) => {
    ctx.fixture = buildFixture();
    // Telegram configured (and the front-desk pid already alive) so the
    // "when configured" half of the Then step below is genuinely exercised,
    // not vacuously true because front-desk was never checked at all.
    fs.writeFileSync(ctx.fixture.frontDeskPidFile, `${process.pid}\n`);
    ctx.envOverrides = {
      TELEGRAM_BOT_TOKEN: 'accept-test-token',
      TELEGRAM_CHAT_ID: '1',
      TELEGRAM_PRINCIPAL_USER_ID: '2',
    };
  });

  registry.define(/^\.\/swarm ensure runs$/, (ctx) => {
    ctx.lastResult = runEnsure(ctx.fixture, ctx.envOverrides || {});
  });

  registry.define(/^it also checks the operator runtime and, when configured, the front-desk supervisor$/, (ctx) => {
    if (!/^operator: /m.test(ctx.lastResult.stdout)) {
      throw new Error(`expected an "operator:" report line, got:\n${ctx.lastResult.stdout}`);
    }
    if (!/^front-desk: /m.test(ctx.lastResult.stdout)) {
      throw new Error(`expected a "front-desk:" report line when Telegram is configured, got:\n${ctx.lastResult.stdout}`);
    }
  });

  registry.define(/^each component is reported as HEALTHY, FIXED, or FAILED$/, (ctx) => {
    const lines = ctx.lastResult.stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      throw new Error('expected at least one component report line');
    }
    for (const line of lines) {
      if (!/: (HEALTHY|FIXED|FAILED)/.test(line)) {
        throw new Error(`expected every report line to name HEALTHY/FIXED/FAILED, got: ${line}`);
      }
    }
  });

  registry.define(/^running ensure again when everything is already up reports every component HEALTHY and changes nothing$/, (ctx) => {
    try {
      const before = fs.readFileSync(ctx.fixture.paneDeadFile, 'utf8');
      const second = runEnsure(ctx.fixture, ctx.envOverrides || {});
      const lines = second.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        if (!line.endsWith(': HEALTHY')) {
          throw new Error(`expected every component HEALTHY on a re-run with nothing to fix, got: ${line}`);
        }
      }
      if (second.status !== 0) {
        throw new Error(`expected exit 0 on the idempotent re-run, got ${second.status}`);
      }
      const after = fs.readFileSync(ctx.fixture.paneDeadFile, 'utf8');
      if (before !== after) {
        throw new Error('expected the already-healthy pane state to be left unchanged by a no-op ensure run');
      }
    } finally {
      cleanupFixture(ctx.fixture);
    }
  });

  // ── start-swarm-ensure-03 (Scenario Outline) ─────────────────────────────
  registry.define(/^Telegram front-desk env is "([^"]*)"$/, (ctx, value) => {
    ctx.telegramConfigured = knownTelegramEnv(value);
  });

  registry.define(/^a prior front-desk pid file is "([^"]*)"$/, (ctx, value) => {
    const priorPidPresent = knownPriorPid(value);
    ctx.fixture = buildFixture();
    ctx.envOverrides = ctx.telegramConfigured
      ? { TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: '1', TELEGRAM_PRINCIPAL_USER_ID: '2' }
      : {};
    if (priorPidPresent) {
      fs.writeFileSync(ctx.fixture.frontDeskPidFile, `${process.pid}\n`);
    }
  });

  registry.define(/^the front-desk component is "([^"]*)"$/, (ctx, value) => {
    try {
      const expectChecked = knownFrontDesk(value);
      const wasChecked = /^front-desk: /m.test(ctx.lastResult.stdout);
      if (wasChecked !== expectChecked) {
        throw new Error(`expected front-desk checked=${expectChecked}, got checked=${wasChecked}; output:\n${ctx.lastResult.stdout}`);
      }
    } finally {
      cleanupFixture(ctx.fixture);
    }
  });

  // ── start-swarm-ensure-04 ─────────────────────────────────────────────────
  registry.define(/^a component's skip flag is set$/, (ctx) => {
    ctx.fixture = buildFixture();
    // Telegram IS configured, so the front-desk component would otherwise be
    // checked - proving the skip flag, not "never configured", is what
    // omits it.
    ctx.envOverrides = {
      TELEGRAM_BOT_TOKEN: 'x',
      TELEGRAM_CHAT_ID: '1',
      TELEGRAM_PRINCIPAL_USER_ID: '2',
      SWARMFORGE_SKIP_FRONT_DESK: '1',
    };
  });

  registry.define(/^the cold launch or ensure runs$/, (ctx) => {
    ctx.lastResult = runEnsure(ctx.fixture, ctx.envOverrides);
  });

  registry.define(/^that component is skipped$/, (ctx) => {
    if (/^front-desk: /m.test(ctx.lastResult.stdout)) {
      throw new Error(`expected the front-desk component to be skipped despite Telegram being configured, got:\n${ctx.lastResult.stdout}`);
    }
  });

  registry.define(/^the other components are still brought up or checked$/, (ctx) => {
    try {
      if (!/^daemon: HEALTHY$/m.test(ctx.lastResult.stdout)) {
        throw new Error(`expected the daemon component to still be checked, got:\n${ctx.lastResult.stdout}`);
      }
      if (!/^operator: HEALTHY$/m.test(ctx.lastResult.stdout)) {
        throw new Error(`expected the operator component to still be checked, got:\n${ctx.lastResult.stdout}`);
      }
    } finally {
      cleanupFixture(ctx.fixture);
    }
  });

  // ── start-swarm-ensure-05 ─────────────────────────────────────────────────
  registry.define(/^the changes to swarm_ensure\.bb, swarmforge\.sh, and start-swarm\.sh$/, (ctx) => {
    ctx.touchedScripts = [SWARM_ENSURE, SWARMFORGE_SH, START_SWARM_SH, TEST_SWARM_ENSURE_SH];
    for (const p of ctx.touchedScripts) {
      if (!fs.existsSync(p)) {
        throw new Error(`expected touched script to exist: ${p}`);
      }
    }
  });

  registry.define(/^the swarm hard gates for the touched scripts run$/, (ctx) => {
    ctx.gate = {};
    try {
      execFileSync('zsh', ['-n', SWARMFORGE_SH], { encoding: 'utf8' });
      ctx.gate.swarmforgeShSyntaxOk = true;
    } catch (err) {
      ctx.gate.swarmforgeShSyntaxOk = false;
      ctx.gate.swarmforgeShSyntaxError = String(err.stderr || err.message);
    }
    try {
      execFileSync('bash', ['-n', START_SWARM_SH], { encoding: 'utf8' });
      ctx.gate.startSwarmShSyntaxOk = true;
    } catch (err) {
      ctx.gate.startSwarmShSyntaxOk = false;
      ctx.gate.startSwarmShSyntaxError = String(err.stderr || err.message);
    }
    try {
      const out = execFileSync('bash', [TEST_SWARM_ENSURE_SH], { encoding: 'utf8' });
      ctx.gate.testOut = out;
      ctx.gate.testPass = out.includes('ALL PASS');
    } catch (err) {
      ctx.gate.testPass = false;
      ctx.gate.testOut = `${err.stdout || ''}${err.stderr || ''}`;
    }
  });

  registry.define(/^they all pass, not merely a Cursor-side run$/, (ctx) => {
    if (!ctx.gate.swarmforgeShSyntaxOk) {
      throw new Error(`expected swarmforge.sh to pass its zsh -n syntax gate: ${ctx.gate.swarmforgeShSyntaxError}`);
    }
    if (!ctx.gate.startSwarmShSyntaxOk) {
      throw new Error(`expected start-swarm.sh to pass its bash -n syntax gate: ${ctx.gate.startSwarmShSyntaxError}`);
    }
    if (!ctx.gate.testPass) {
      throw new Error(`expected test_swarm_ensure.sh to report ALL PASS, got:\n${ctx.gate.testOut}`);
    }
  });

  // ── start-swarm-ensure-06 (documenter-owned; real check, not a stub) ────
  registry.define(/^the documenter pass for this ticket completes$/, (ctx) => {
    const candidates = [path.join(REPO_ROOT, 'docs', 'tutorials', 'GettingStarted.md'), path.join(REPO_ROOT, 'README.md')].filter((p) =>
      fs.existsSync(p)
    );
    ctx.docsCandidates = candidates;
    ctx.docsText = candidates.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  });

  registry.define(
    /^Getting Started and\/or the README name \.\/start-swarm\.sh as the restart command and \.\/swarm ensure as the repair command$/,
    (ctx) => {
      if (!ctx.docsText.includes('start-swarm.sh')) {
        throw new Error('expected Getting Started and/or the README to name ./start-swarm.sh as the restart command');
      }
      if (!ctx.docsText.includes('swarm ensure')) {
        throw new Error('expected Getting Started and/or the README to name ./swarm ensure as the repair command');
      }
    }
  );

  registry.define(/^they document the Telegram env requirements and the skip flags$/, (ctx) => {
    for (const name of TELEGRAM_ENV_VARS) {
      if (!ctx.docsText.includes(name)) {
        throw new Error(`expected the docs to document the Telegram env var ${name}`);
      }
    }
    for (const flag of SKIP_FLAG_VARS) {
      if (!ctx.docsText.includes(flag)) {
        throw new Error(`expected the docs to document the skip flag ${flag}`);
      }
    }
  });

  registry.define(/^every command and script the docs name exists in the repo$/, (ctx) => {
    if (ctx.docsCandidates.length === 0) {
      throw new Error('expected at least one docs file (Getting Started or README) to exist');
    }
    const named = [
      'start-swarm.sh',
      'swarmforge/scripts/swarm_ensure.bb',
      'swarmforge/scripts/launch_front_desk.sh',
      'swarmforge/scripts/start_operator_runtime.sh',
    ];
    for (const rel of named) {
      if (ctx.docsText.includes(rel) && !fs.existsSync(path.join(REPO_ROOT, rel))) {
        throw new Error(`docs name "${rel}" but it does not exist in the repo`);
      }
    }
  });
}

module.exports = { registerSteps };
