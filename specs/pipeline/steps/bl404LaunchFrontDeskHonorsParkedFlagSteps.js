'use strict';

// BL-404: step handlers for "launching the front desk respects a
// human-authored park flag". Drives the REAL launch_front_desk.sh and
// unpark_front_desk.sh scripts via execFileSync against a disposable
// fixture root - no real bridge/bot process is ever spawned (the park
// scenarios exit before either is reached, and the "proceeds normally"
// scenario uses FRONT_DESK_LAUNCH_DRYRUN=1, same as the existing smoke
// test in swarmforge/scripts/test/test_launch_front_desk.sh).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAUNCHER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_front_desk.sh');
const UNPARK = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'unpark_front_desk.sh');

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl404-front-desk-'));
  fs.mkdirSync(path.join(root, 'extension', 'out', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(root, 'extension', 'out', 'tools', 'start-bridge-headless.js'), '');
  fs.writeFileSync(path.join(root, 'extension', 'out', 'tools', 'telegram-front-desk-bot.js'), '');
  return root;
}

// Explicit allowlist, never `{...process.env}`: this dev box exports REAL
// live Telegram credentials globally, and launch_front_desk.sh is exactly
// the script a stray spread once leaked them into (see
// frontDeskSurvivesRebootSteps.js's own fixtureEnv(), the established
// pattern for this same script family).
function fixtureEnv(extra) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TELEGRAM_BOT_TOKEN: 'bl404-fixture-fake-bot-token',
    TELEGRAM_CHAT_ID: 'bl404-fixture-fake-chat-id',
    TELEGRAM_PRINCIPAL_USER_ID: 'bl404-fixture-fake-user-id',
    ...extra,
  };
}

// launch_front_desk.sh writes its PARKED message to stderr; execFileSync's
// plain return value is stdout only on success, silently dropping it.
// spawnSync captures both streams regardless of exit code.
function run(script, args, extraEnv) {
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: fixtureEnv(extraEnv),
  });
  return { code: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

function runLauncher(root, env) {
  return run(LAUNCHER, [root], env);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a front-desk launch invoked via launch_front_desk\.sh$/, (ctx) => {
    ctx.root = makeFixtureRoot();
    ctx.parkedFile = path.join(ctx.root, '.swarmforge', 'operator', 'front-desk-PARKED.md');
    ctx.stopFile = path.join(ctx.root, '.swarmforge', 'operator', 'front-desk-supervisor.stop');
  });

  // ── launch-honors-park-01 ─────────────────────────────────────────────
  registry.define(/^\.swarmforge\/operator\/front-desk-PARKED\.md exists$/, (ctx) => {
    fs.writeFileSync(ctx.parkedFile, 'DO NOT RESTART\n');
  });

  registry.define(/^launch_front_desk\.sh runs$/, (ctx) => {
    ctx.result = runLauncher(ctx.root, {});
  });

  registry.define(/^it logs that the front desk is PARKED and does not launch$/, (ctx) => {
    if (!ctx.result.output.includes('PARKED')) {
      throw new Error(`expected a PARKED message, got: ${ctx.result.output}`);
    }
    const pidFile = path.join(ctx.root, '.swarmforge', 'operator', 'front-desk-supervisor.pid');
    if (fs.existsSync(pidFile)) {
      throw new Error('expected no supervisor pid file to be written while parked');
    }
  });

  registry.define(/^it exits 0$/, (ctx) => {
    if (ctx.result.code !== 0) {
      throw new Error(`expected exit code 0, got ${ctx.result.code}: ${ctx.result.output}`);
    }
  });

  // ── launch-honors-park-02 ─────────────────────────────────────────────
  registry.define(/^launch_front_desk\.sh runs and refuses to launch$/, (ctx) => {
    fs.writeFileSync(ctx.stopFile, '');
    ctx.result = runLauncher(ctx.root, {});
  });

  registry.define(/^front-desk-PARKED\.md still exists afterward$/, (ctx) => {
    if (!fs.existsSync(ctx.parkedFile)) {
      throw new Error('expected the park flag to still exist after a refused launch');
    }
  });

  registry.define(/^front-desk-supervisor\.stop is not removed$/, (ctx) => {
    if (!fs.existsSync(ctx.stopFile)) {
      throw new Error('expected front-desk-supervisor.stop to be left untouched');
    }
  });

  // ── launch-honors-park-03 ──────────────────────────────────────────────
  registry.define(/^no front-desk-PARKED\.md file exists$/, (ctx) => {
    if (fs.existsSync(ctx.parkedFile)) {
      fs.unlinkSync(ctx.parkedFile);
    }
  });

  registry.define(/^it launches the front-desk trio as before$/, (ctx) => {
    ctx.result = runLauncher(ctx.root, { FRONT_DESK_LAUNCH_DRYRUN: '1' });
    if (!ctx.result.output.includes('DRYRUN bridge cmd:') || !ctx.result.output.includes('DRYRUN bot cmd:')) {
      throw new Error(`expected a normal (dry-run) launch, got: ${ctx.result.output}`);
    }
  });

  // ── launch-honors-park-04 ──────────────────────────────────────────────
  registry.define(/^front-desk-PARKED\.md exists$/, (ctx) => {
    fs.writeFileSync(ctx.parkedFile, 'DO NOT RESTART\n');
  });

  registry.define(/^the unpark script is run$/, (ctx) => {
    ctx.result = run(UNPARK, [ctx.root], {});
  });

  registry.define(/^front-desk-PARKED\.md no longer exists$/, (ctx) => {
    if (fs.existsSync(ctx.parkedFile)) {
      throw new Error('expected the unpark script to remove the park flag');
    }
  });
}

module.exports = { registerSteps };
