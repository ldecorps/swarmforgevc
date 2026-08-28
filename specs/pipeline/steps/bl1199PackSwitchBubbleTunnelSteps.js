'use strict';

// BL-1199: step handlers for "a pack switch or ensure cycle never leaves
// the Bubble named tunnel dead and undetected". Drives the REAL
// start_ancillary_services.sh and swarm_status.bb (no mocked pid checks) -
// same established pattern as test_named_tunnel_liveness_ancillary_start.sh
// / test_swarm_status_bubble_tunnel_row.sh (this file's shell siblings).
// HOME is pointed at an empty fixture dir for the ancillary-start scenario
// so the script's own unconditional `source "$HOME/.zshenv"` cannot pull in
// this machine's real Telegram/Cursor credentials (this session's own
// "~/.zshenv re-exports real keys over fixture values" hazard).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'a pack switch or ensure cycle never leaves the Bubble named tunnel dead and undetected';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1199-aps-'));
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1199-home-'));
  const fixtureScripts = path.join(root, 'swarmforge', 'scripts');
  fs.mkdirSync(fixtureScripts, { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  for (const name of ['start_ancillary_services.sh', 'named_tunnel_liveness_check.bb', 'named_tunnel_liveness_lib.bb', 'lifecycle_help_lib.sh']) {
    const src = path.join(REAL_SCRIPTS_DIR, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(fixtureScripts, name));
    }
  }
  ctx.root = root;
  ctx.emptyHome = emptyHome;
  ctx.fixtureScripts = fixtureScripts;
  ctx.relaunchCountFile = path.join(root, 'relaunch-count');
  fs.writeFileSync(ctx.relaunchCountFile, '0');
  return root;
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = undefined;
  }
  if (ctx.emptyHome) {
    fs.rmSync(ctx.emptyHome, { recursive: true, force: true });
    ctx.emptyHome = undefined;
  }
}

function writeStubLauncher(ctx, { overwritesPidWith } = {}) {
  const overwriteLine = overwritesPidWith !== undefined
    ? `echo "${overwritesPidWith}" > "${path.join(ctx.root, '.swarmforge', 'operator', 'resident-spy-cloudflared.pid')}"\n`
    : '';
  const script = `#!/usr/bin/env bash
count=$(cat "${ctx.relaunchCountFile}")
echo $((count + 1)) > "${ctx.relaunchCountFile}"
${overwriteLine}exit 0
`;
  const p = path.join(ctx.fixtureScripts, 'launch_resident_spy_tunnel.sh');
  fs.writeFileSync(p, script);
  fs.chmodSync(p, 0o755);
}

function runAncillaryStart(ctx) {
  const result = spawnSync('bash', [path.join(ctx.fixtureScripts, 'start_ancillary_services.sh'), ctx.root], {
    env: {
      ...process.env,
      HOME: ctx.emptyHome,
      SWARMFORGE_SKIP_OPERATOR: '1',
      SWARMFORGE_SKIP_FRONT_DESK: '1',
      SWARMFORGE_SKIP_CURSOR_BRIDGE: '1',
      SWARMFORGE_SKIP_ONBOARDER: '1',
      SWARMFORGE_SKIP_BABYSITTERD: '1',
      SWARMFORGE_SKIP_FRESHNESS_CRON: '1',
      SWARMFORGE_SKIP_SCHEDULE_CRON: '1',
      SWARMFORGE_SKIP_TUNNEL: '1',
    },
    encoding: 'utf8',
  });
  ctx.ancillaryStderr = result.stderr || '';
  ctx.ancillaryStdout = result.stdout || '';
}

function runSwarmStatus(ctx) {
  const out = execFileSync('bb', [path.join(REAL_SCRIPTS_DIR, 'swarm_status.bb'), ctx.root], { encoding: 'utf8' });
  ctx.statusOut = out;
}

function rowFor(text, name) {
  const line = text.split('\n').find((l) => new RegExp(`^\\s*\\S+\\s+${name}\\s`).test(l));
  return line || '';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a named tunnel is configured for the operator root$/, (ctx) => {
    mkFixture(ctx);
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'operator', 'named-tunnel.env'), 'SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble\n');
  });

  scoped(/^the named tunnel launcher exited successfully$/, (ctx) => {
    // The stub always exits 0 - what varies is whether the pidfile it
    // leaves behind is actually alive, set by the next step.
    ctx.launcherExitedSuccessfully = true;
  });

  scoped(/^the recorded named-tunnel pid is no longer alive$/, (ctx) => {
    const deadPid = 99999999;
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'operator', 'resident-spy-cloudflared.pid'), String(deadPid));
    writeStubLauncher(ctx, { overwritesPidWith: deadPid });
  });

  scoped(/^ancillary start reports its named-tunnel outcome$/, (ctx) => {
    try {
      runAncillaryStart(ctx);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the named tunnel is reported down$/, (ctx) => {
    try {
      assert.match(ctx.ancillaryStderr, /bubble named tunnel/i);
      assert.match(ctx.ancillaryStderr, /down/i);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the report names the named tunnel rather than the editor tunnel$/, (ctx) => {
    try {
      assert.match(ctx.ancillaryStderr, /bubble named tunnel/i);
      assert.ok(!/vscode/i.test(ctx.ancillaryStderr), `expected no mention of the editor tunnel, got: ${ctx.ancillaryStderr}`);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the editor tunnel is ([a-z]+) and the named tunnel is ([a-z]+)$/, (ctx, editor, named) => {
    const opDir = path.join(ctx.root, '.swarmforge', 'operator');
    fs.writeFileSync(path.join(opDir, 'tunnel.pid'), editor === 'up' ? String(process.pid) : '99999999');
    fs.writeFileSync(path.join(opDir, 'resident-spy-cloudflared.pid'), named === 'up' ? String(process.pid) : '99999999');
  });

  scoped(/^swarm status renders its tunnel rows$/, (ctx) => {
    try {
      runSwarmStatus(ctx);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the "([^"]+)" row reports ([a-z]+)$/, (ctx, rowName, expected) => {
    try {
      const line = rowFor(ctx.statusOut, rowName);
      assert.ok(line, `expected a "${rowName}" row, got status output: ${ctx.statusOut}`);
      assert.match(line, new RegExp(`^\\s*${expected.toUpperCase()}`), `expected "${rowName}" to report ${expected}, got: ${line}`);
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
