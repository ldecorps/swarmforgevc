'use strict';

// BL-1779: step handlers for "a root that declares no swarm name never
// takes a fleet swarm's Telegram identity". Scenarios 01/03 drive the REAL
// fleet_telegram_creds_cli.bb (same posture as
// bl436PerSwarmTelegramCredsSteps.js's own resolveCreds - this CLI is the
// exact call fleet_telegram_creds_lib.bb's tests already cover at the pure-
// function level; this file proves the CLI's own dispatch between the
// declared and undeclared paths). Scenario 02 drives the REAL
// front_desk_supervisor.bb directly (no closure copy needed - it is
// invoked from its own real location, never a foreign target's copy) to
// prove the primary-root record is never written for an undeclared root.
// Every fixture uses its own isolated HOME/fleet-home - never the real
// $HOME, which is genuinely populated with live fleet state on this host.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CREDS_CLI = path.join(SWARM_SCRIPTS, 'fleet_telegram_creds_cli.bb');
const SUPERVISOR = path.join(SWARM_SCRIPTS, 'front_desk_supervisor.bb');

function fixtureEnv(extra) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...extra,
  };
}

function writeSwarmIdentity(projectRoot, swarmName) {
  fs.mkdirSync(path.join(projectRoot, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.swarmforge', 'swarm-identity'),
    `swarm_name\t${swarmName}\nswarm_mode\tautonomous\nswarm_mode_primary\ttrue\n`
  );
}

function writeFleetCredsFile(fleetHome, swarmName, creds) {
  const dir = path.join(fleetHome, '.swarmforge', 'fleet', swarmName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram.json'), JSON.stringify(creds));
}

function primaryRootRecordPath(fleetHome) {
  return path.join(fleetHome, '.swarmforge', 'fleet', 'primary', 'root');
}

function writePrimaryRootRecord(fleetHome, recordedRoot) {
  const dir = path.dirname(primaryRootRecordPath(fleetHome));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(primaryRootRecordPath(fleetHome), recordedRoot);
}

function resolveCreds(projectRoot, fleetHome, env) {
  const out = execFileSync('bb', [CREDS_CLI, projectRoot], {
    encoding: 'utf8',
    env: fixtureEnv({ ...env, SWARMFORGE_FLEET_HOME: fleetHome }),
  });
  return JSON.parse(out.trim());
}

// Explicit KNOWN_VALUES map (BL-1768 convention): the Outline's <record
// state> cell selects a fixture builder, never passed through unchecked.
const RECORD_STATE_SETUPS = new Map([
  ['records another checkout as the primary root', (ctx) => {
    const otherRoot = trackedTmpRoot('bl1779-other-root-');
    writePrimaryRootRecord(ctx.fleetHome, otherRoot);
  }],
  ['has no primary-root record', () => {
    // Deliberately a no-op: no fleet/primary/root file is ever written -
    // the bootstrap-window shape.
  }],
]);

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a fixture fleet home whose primary creds file names bot token "([^"]+)" and bridge port (\d+)$/, (ctx, botToken, bridgePort) => {
    ctx.fleetHome = trackedTmpRoot('bl1779-fleet-home-');
    writeFleetCredsFile(ctx.fleetHome, 'primary', { botToken, chatId: 'primary-chat', bridgePort: Number(bridgePort) });
  });

  // ── shared across 01/02 ──────────────────────────────────────────────
  registry.define(/^the fixture fleet home (records another checkout as the primary root|has no primary-root record)$/, (ctx, state) => {
    const setup = RECORD_STATE_SETUPS.get(state);
    if (!setup) {
      throw new Error(`unknown record state: ${state}`);
    }
    setup(ctx);
  });

  registry.define(/^a fixture project root with no swarm identity$/, (ctx) => {
    ctx.projectRoot = trackedTmpRoot('bl1779-project-');
  });

  // ── an-undeclared-root-never-resolves-a-fleet-creds-file-01 ─────────────
  registry.define(/^the creds CLI resolves that root with environment bridge port (\d+)$/, (ctx, port) => {
    ctx.resolved = resolveCreds(ctx.projectRoot, ctx.fleetHome, { BRIDGE_PORT: port });
  });

  registry.define(/^the resolved bot token is not "([^"]+)"$/, (ctx, token) => {
    assert.notEqual(ctx.resolved.botToken, token);
  });

  registry.define(/^the resolved bridge port is not (\d+)$/, (ctx, port) => {
    assert.notEqual(ctx.resolved.bridgePort, Number(port));
  });

  // ── an-undeclared-root-never-records-itself-as-primary-02 ───────────────
  registry.define(/^that root's front-desk supervisor starts and stops$/, (ctx) => {
    const opDir = path.join(ctx.projectRoot, '.swarmforge', 'operator');
    fs.mkdirSync(opDir, { recursive: true });
    // The record write happens at namespace load, before the run loop
    // even starts - pre-arming the stop file means the loop's own `while
    // (not (fs/exists? stop-file))` never ticks at all (no spawn attempt
    // ever needed: no compiled extension/out required in this fixture).
    fs.writeFileSync(path.join(opDir, 'front-desk-supervisor.stop'), '');
    spawnSync('bb', [SUPERVISOR, ctx.projectRoot], {
      encoding: 'utf8',
      env: fixtureEnv({ SWARMFORGE_FLEET_HOME: ctx.fleetHome }),
    });
  });

  registry.define(/^the fixture fleet home still has no primary-root record$/, (ctx) => {
    assert.equal(fs.existsSync(primaryRootRecordPath(ctx.fleetHome)), false, 'expected no primary-root record to be written');
  });

  // ── a-declared-root-keeps-its-own-creds-03 ──────────────────────────────
  registry.define(/^a fixture project root whose swarm identity declares "([^"]+)"$/, (ctx, swarmName) => {
    ctx.projectRoot = trackedTmpRoot('bl1779-project-');
    writeSwarmIdentity(ctx.projectRoot, swarmName);
  });

  registry.define(/^the resolved bot token is "([^"]+)"$/, (ctx, token) => {
    assert.equal(ctx.resolved.botToken, token);
  });

  registry.define(/^the resolved bridge port is (\d+)$/, (ctx, port) => {
    assert.equal(ctx.resolved.bridgePort, Number(port));
  });
}

module.exports = { registerSteps };
