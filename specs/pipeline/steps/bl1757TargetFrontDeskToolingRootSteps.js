'use strict';

// BL-1757: step handlers for "a target's front desk and Cursor Remote
// bridge start from the tooling root's compiled tools". Drives the REAL
// swarmforge.sh (parse_config), launch_front_desk.sh and
// start_cursor_bridge.sh via spawnSync against disposable mkdtemp fixtures
// (BL-1390) - same posture as bl404LaunchFrontDeskHonorsParkedFlagSteps.js.
// Every scenario stays inside dry-run mode, or (scenario 04) a real launch
// that refuses before ever reaching the supervisor spawn, so nothing real
// is ever started.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1757 A target's front desk and Cursor Remote bridge start from the tooling root's compiled tools";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');
const FRONT_DESK_LAUNCHER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'launch_front_desk.sh');
const CURSOR_BRIDGE_LAUNCHER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'start_cursor_bridge.sh');

// Explicit KNOWN_VALUES maps (BL-1768 convention): a Scenario Outline
// handler validates its <launcher>/<entrypoint> cells against these, never
// passing an Examples cell through unchecked.
const LAUNCHER_SCRIPTS = new Map([
  ['launch_front_desk.sh', { script: FRONT_DESK_LAUNCHER, dryRunEnvVar: 'FRONT_DESK_LAUNCH_DRYRUN' }],
  ['start_cursor_bridge.sh', { script: CURSOR_BRIDGE_LAUNCHER, dryRunEnvVar: 'CURSOR_BRIDGE_LAUNCH_DRYRUN' }],
]);

const ENTRYPOINT_RELATIVE_PATHS = new Map([
  ['start-bridge-headless.js', path.join('tools', 'start-bridge-headless.js')],
  ['telegram-front-desk-bot.js', path.join('tools', 'telegram-front-desk-bot.js')],
  ['telegram-cursor-bridge.js', path.join('tools', 'telegram-cursor-bridge.js')],
]);

// Explicit allowlist, never `{...process.env}`: this dev box exports REAL
// live Telegram credentials globally, and these launchers are exactly the
// scripts a stray spread once leaked them into (see
// bl404LaunchFrontDeskHonorsParkedFlagSteps.js's own fixtureEnv()).
function fixtureEnv(extra) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...extra,
  };
}

function run(script, args, extraEnv) {
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: fixtureEnv(extraEnv),
  });
  return { code: result.status, output: (result.stdout || '') + (result.stderr || '') };
}

function makeBareRoot(prefix) {
  return trackedTmpRoot(prefix);
}

function makeTargetWithOwnEntrypoints() {
  const root = trackedTmpRoot('bl1757-target-');
  fs.mkdirSync(path.join(root, 'extension', 'out', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(root, 'extension', 'out', 'tools', 'start-bridge-headless.js'), '');
  fs.writeFileSync(path.join(root, 'extension', 'out', 'tools', 'telegram-front-desk-bot.js'), '');
  return root;
}

function servedRootToken(output, expectedEntrypointPath, targetRoot) {
  const line = output.split('\n').find((l) => l.includes(expectedEntrypointPath));
  return Boolean(line) && line.split(/\s+/).includes(targetRoot);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenario 01: conf-records-the-tooling-root ──────────────────────────
  scoped(/^a pack conf carrying "config tooling_root" with an absolute tooling root$/, (ctx) => {
    ctx.confRoot = makeBareRoot('bl1757-conf-');
    fs.mkdirSync(path.join(ctx.confRoot, 'swarmforge', 'roles'), { recursive: true });
    fs.writeFileSync(path.join(ctx.confRoot, 'swarmforge', 'constitution.prompt'), 'constitution\n');
    fs.writeFileSync(path.join(ctx.confRoot, 'swarmforge', 'roles', 'coder.prompt'), 'role prompt\n');
    ctx.toolingRoot = makeBareRoot('bl1757-tooling-');
    fs.writeFileSync(
      path.join(ctx.confRoot, 'swarmforge', 'swarmforge.conf'),
      `config tooling_root ${ctx.toolingRoot}\nwindow coder claude coder --model claude-haiku-4-5-20251001\n`,
    );
  });

  scoped(/^the pack conf is parsed$/, (ctx) => {
    const script = `source '${SWARMFORGE_SH}' '${ctx.confRoot}'; parse_config; printf 'TOOLING_ROOT=[%s]\\n' "$SWARMFORGE_TOOLING_ROOT"`;
    const result = spawnSync('zsh', ['-c', script], {
      encoding: 'utf8',
      env: fixtureEnv({ PACK_STAFFING_SKIP_GATE: '1' }),
    });
    ctx.parseOutput = (result.stdout || '') + (result.stderr || '');
  });

  scoped(/^SWARMFORGE_TOOLING_ROOT names that tooling root$/, (ctx) => {
    if (!ctx.parseOutput.includes(`TOOLING_ROOT=[${ctx.toolingRoot}]`)) {
      throw new Error(`expected SWARMFORGE_TOOLING_ROOT to name the tooling root, got: ${ctx.parseOutput}`);
    }
  });

  // ── scenario 02 (Outline) / 04 shared given ─────────────────────────────
  scoped(/^a target with no extension\/ directory of its own$/, (ctx) => {
    ctx.targetRoot = makeBareRoot('bl1757-target-');
  });

  // ── scenario 02 (Outline) ────────────────────────────────────────────
  scoped(/^SWARMFORGE_TOOLING_ROOT names a tooling root holding the compiled (.+)$/, (ctx, entrypointName) => {
    const relative = ENTRYPOINT_RELATIVE_PATHS.get(entrypointName);
    if (!relative) {
      throw new Error(`unknown entrypoint: ${entrypointName}`);
    }
    ctx.toolingRoot = makeBareRoot('bl1757-tooling-');
    fs.mkdirSync(path.join(ctx.toolingRoot, 'extension', 'out', 'tools'), { recursive: true });
    fs.writeFileSync(path.join(ctx.toolingRoot, 'extension', 'out', relative), '');
    ctx.entrypointRelative = relative;
  });

  scoped(/^(.+) is dry-run for the target$/, (ctx, launcherName) => {
    const launcherCase = LAUNCHER_SCRIPTS.get(launcherName);
    if (!launcherCase) {
      throw new Error(`unknown launcher: ${launcherName}`);
    }
    ctx.result = run(launcherCase.script, [ctx.targetRoot], {
      [launcherCase.dryRunEnvVar]: '1',
      SWARMFORGE_TOOLING_ROOT: ctx.toolingRoot,
    });
  });

  scoped(/^the (.+) it would start is under the tooling root$/, (ctx, entrypointName) => {
    const relative = ENTRYPOINT_RELATIVE_PATHS.get(entrypointName);
    if (!relative) {
      throw new Error(`unknown entrypoint: ${entrypointName}`);
    }
    ctx.expectedEntrypointPath = path.join(ctx.toolingRoot, 'extension', 'out', relative);
    if (!ctx.result.output.includes(ctx.expectedEntrypointPath)) {
      throw new Error(`expected the tooling root's own path in the output, got: ${ctx.result.output}`);
    }
  });

  scoped(/^the project root it would serve is the target$/, (ctx) => {
    if (!servedRootToken(ctx.result.output, ctx.expectedEntrypointPath, ctx.targetRoot)) {
      throw new Error(`expected the served project root argument to be the target, got: ${ctx.result.output}`);
    }
  });

  // ── scenario 03: swarmforgevc-resolves-as-today ─────────────────────────
  scoped(/^a project root holding its own compiled extension\/out and no SWARMFORGE_TOOLING_ROOT$/, (ctx) => {
    ctx.targetRoot = makeTargetWithOwnEntrypoints();
  });

  scoped(/^launch_front_desk\.sh is dry-run for that project$/, (ctx) => {
    ctx.result = run(FRONT_DESK_LAUNCHER, [ctx.targetRoot], { FRONT_DESK_LAUNCH_DRYRUN: '1' });
  });

  scoped(/^every entrypoint it would start is under the project root's own extension\/out$/, (ctx) => {
    const bridge = path.join(ctx.targetRoot, 'extension', 'out', 'tools', 'start-bridge-headless.js');
    const bot = path.join(ctx.targetRoot, 'extension', 'out', 'tools', 'telegram-front-desk-bot.js');
    if (!ctx.result.output.includes(bridge) || !ctx.result.output.includes(bot)) {
      throw new Error(`expected both entrypoints under the project's own build, got: ${ctx.result.output}`);
    }
  });

  // ── scenario 04: nowhere-to-start-from-is-loud ──────────────────────────
  // "no SWARMFORGE_TOOLING_ROOT" is the launching shell's own env - the
  // relaunch path this scenario proves (front_desk_supervisor.bb,
  // babysitterd, `swarm ensure`) does not inherit it and instead discovers
  // the SAME tooling root via the target's own pack conf (the ticket's own
  // "How" fallback requirement) - so "both places it looked" is the
  // tooling root's own (still-missing) copy and the target's own. A launch
  // with NEITHER an env var NOR any conf-named tooling root at all has only
  // one real candidate and keeps the exact pre-BL-1757 single-path
  // wording - already proven byte-identical by scenario 03 and the
  // launchers' own pre-existing smoke tests, never re-tested here.
  scoped(/^no SWARMFORGE_TOOLING_ROOT$/, (ctx) => {
    fs.mkdirSync(path.join(ctx.targetRoot, 'swarmforge'), { recursive: true });
    ctx.toolingRoot = makeBareRoot('bl1757-tooling-');
    fs.writeFileSync(
      path.join(ctx.targetRoot, 'swarmforge', 'swarmforge.conf'),
      `config tooling_root ${ctx.toolingRoot}\n`,
    );
  });

  scoped(/^launch_front_desk\.sh runs for the target$/, (ctx) => {
    ctx.result = run(FRONT_DESK_LAUNCHER, [ctx.targetRoot], {
      TELEGRAM_BOT_TOKEN: 'bl1757-fixture-fake-bot-token',
      TELEGRAM_CHAT_ID: 'bl1757-fixture-fake-chat-id',
      TELEGRAM_PRINCIPAL_USER_ID: 'bl1757-fixture-fake-user-id',
    });
  });

  scoped(/^it exits non-zero naming both places it looked for the bridge entrypoint$/, (ctx) => {
    const underTooling = path.join(ctx.toolingRoot, 'extension', 'out', 'tools', 'start-bridge-headless.js');
    const underTarget = path.join(ctx.targetRoot, 'extension', 'out', 'tools', 'start-bridge-headless.js');
    if (ctx.result.code === 0) {
      throw new Error('expected a non-zero exit when neither place has the entrypoint');
    }
    if (!ctx.result.output.includes(underTooling) || !ctx.result.output.includes(underTarget)) {
      throw new Error(`expected the refusal to name both paths it looked in, got: ${ctx.result.output}`);
    }
  });

  scoped(/^nothing is started$/, (ctx) => {
    const pidFile = path.join(ctx.targetRoot, '.swarmforge', 'operator', 'front-desk-supervisor.pid');
    if (fs.existsSync(pidFile)) {
      throw new Error('expected no supervisor pid file to be written');
    }
  });
}

module.exports = { registerSteps };
