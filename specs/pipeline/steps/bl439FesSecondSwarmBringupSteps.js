'use strict';

// BL-439 (epic BL-435 slice 4): step handlers for the two executable seams
// of the FES second-swarm bring-up's E2E acceptance - own-creds resolution
// (BL-436) and distinct fleet identity (BL-437). Drives the SAME real
// functions bl436PerSwarmTelegramCredsSteps.js and
// bl437FleetStatusPublishSteps.js already exercise (fleet_telegram_creds_
// cli.bb and fleet-console.js's renderFleet) - never a reimplementation.
// "When the fleet console reads the fleet" is the EXACT step text
// bl437FleetStatusPublishSteps.js already registers (fleet-status-
// publish-02) and is deliberately left unregistered here so that
// already-proven handler drives it; only this scenario's OWN Given/Then
// phrasing (distinct from bl437's) is registered in this file. The other
// two acceptance behaviours (the real Windows-side mono-rotate launch, and
// the live Telegram no-message-theft round-trip) are inherently live and
// stay recorded procedure only, per the feature file's own header comment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CREDS_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'fleet_telegram_creds_cli.bb');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSwarmIdentity(projectRoot, swarmName) {
  fs.mkdirSync(path.join(projectRoot, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.swarmforge', 'swarm-identity'),
    `swarm_name\t${swarmName}\nswarm_mode\tautonomous\nswarm_mode_primary\tfalse\n`
  );
}

function writeFleetCredsFile(fleetHome, swarmName, creds) {
  const dir = path.join(fleetHome, '.swarmforge', 'fleet', swarmName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'telegram.json'), JSON.stringify(creds));
}

function resolveCreds(projectRoot, fleetHome, env) {
  const out = execFileSync('bb', [CREDS_CLI, projectRoot], {
    encoding: 'utf8',
    env: { ...process.env, ...env, SWARMFORGE_FLEET_HOME: fleetHome },
  });
  return JSON.parse(out.trim());
}

function publishStatusDoc(rendezvousDir, swarmName, doc) {
  const dir = path.join(rendezvousDir, swarmName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(doc));
}

function statusDocFor(name, project) {
  return {
    identity: { name, project, kind: 'swarm', coordinatorAddress: `${name}/coordinator` },
    status: 'active',
    health: { expected_panes: 2, live_panes: 2, coordinator_alive: true },
    children: [],
    needs_human: false,
    updated_at: new Date().toISOString(),
  };
}

function registerSteps(registry) {
  // ── fes-second-swarm-bringup-02 ─────────────────────────────────────
  registry.define(/^the FES swarm has its own fleet creds file carrying the FES bot token$/, (ctx) => {
    ctx.projectRoot = mkTmp('bl439-project-');
    ctx.fleetHome = mkTmp('bl439-fleet-home-');
    writeSwarmIdentity(ctx.projectRoot, 'fes');
    writeFleetCredsFile(ctx.fleetHome, 'fes', { botToken: 'fes-bot-token', chatId: 'fes-chat-id', bridgePort: 8765 });
  });

  registry.define(/^the primary's bot token is exported in the environment$/, (ctx) => {
    ctx.env = { TELEGRAM_BOT_TOKEN: 'primary-token-leaked-into-shell', TELEGRAM_CHAT_ID: 'primary-chat-leaked-into-shell' };
  });

  registry.define(/^the FES front desk resolves its Telegram creds$/, (ctx) => {
    ctx.resolved = resolveCreds(ctx.projectRoot, ctx.fleetHome, ctx.env || {});
  });

  registry.define(/^it uses the FES bot token from the fleet creds file$/, (ctx) => {
    assert.equal(ctx.resolved.botToken, 'fes-bot-token');
    assert.equal(ctx.resolved.chatId, 'fes-chat-id');
  });

  registry.define(/^it does not fall back to the primary's token from the environment$/, (ctx) => {
    assert.notEqual(ctx.resolved.botToken, 'primary-token-leaked-into-shell');
  });

  // ── fes-second-swarm-bringup-04 ─────────────────────────────────────
  registry.define(/^the primary and FES swarms have each published their own status\.json$/, (ctx) => {
    ctx.rendezvousDir = mkTmp('bl439-fleet-rendezvous-');
    publishStatusDoc(ctx.rendezvousDir, 'fes', statusDocFor('fes', 'free-email-scanner'));
    publishStatusDoc(ctx.rendezvousDir, 'primary', statusDocFor('primary', 'swarmforgevc'));
  });

  // "When the fleet console reads the fleet" is bl437FleetStatusPublishSteps
  // .js's own registration (fleet-status-publish-02) - identical text,
  // identical action (renderFleet(ctx.rendezvousDir)); not re-registered
  // here, see this file's header comment.

  registry.define(/^it renders the primary and "fes" as two distinct swarms$/, (ctx) => {
    const names = ctx.rendered.swarms.map((s) => s.identity.name).sort();
    assert.deepEqual(names, ['fes', 'primary'], `expected exactly the primary and fes swarms rendered, got: ${JSON.stringify(names)}`);
  });
}

module.exports = { registerSteps };
