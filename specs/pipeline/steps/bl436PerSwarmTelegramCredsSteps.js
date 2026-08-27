'use strict';

// BL-436 (epic BL-435 slice 1): step handlers for "a swarm resolves its
// Telegram creds from its own fleet creds file, keyed by swarm_name".
// Scenarios 01-04 drive the REAL fleet_telegram_creds_cli.bb (which itself
// calls the exact resolve-telegram-creds front_desk_supervisor.bb calls at
// launch - see swarmforge/scripts/test/test_front_desk_supervisor_fleet_creds.sh
// for the real-subprocess-spawn wiring proof, which this suite does not
// repeat). Scenario 05 drives the REAL compiled buildAdapters
// (extension/out/tools/provision-onboarding-telegram-channel.js). Every
// fixture uses its own isolated HOME/project-root - never the real $HOME,
// which is genuinely populated with other fleet state on real hosts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CREDS_CLI = path.join(SWARM_SCRIPTS, 'fleet_telegram_creds_cli.bb');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { buildAdapters } = require(path.join(EXT_DIR, 'out', 'tools', 'provision-onboarding-telegram-channel'));
const { readFleetTelegramCreds } = require(path.join(EXT_DIR, 'out', 'onboarding', 'fleetTelegramCredsStore'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function resolveCreds(projectRoot, fleetHome, env) {
  const out = execFileSync('bb', [CREDS_CLI, projectRoot], {
    encoding: 'utf8',
    env: { ...process.env, ...env, SWARMFORGE_FLEET_HOME: fleetHome },
  });
  return JSON.parse(out.trim());
}

function registerSteps(registry) {
  // ── per-swarm-telegram-creds-01 ─────────────────────────────────────
  registry.define(/^a fleet creds file exists for swarm "([^"]+)" with a bot token and chat id$/, (ctx, swarmName) => {
    ctx.projectRoot = mkTmp('bl436-project-');
    ctx.fleetHome = mkTmp('bl436-fleet-home-');
    ctx.swarmName = swarmName;
    writeSwarmIdentity(ctx.projectRoot, swarmName);
    writeFleetCredsFile(ctx.fleetHome, swarmName, { botToken: `${swarmName}-token`, chatId: `${swarmName}-chat`, bridgePort: 8765 });
  });

  registry.define(/^the front-desk supervisor for swarm "([^"]+)" resolves its Telegram creds$/, (ctx, swarmName) => {
    assert.equal(ctx.swarmName, swarmName, 'internal test setup: scenario swarm name mismatch');
    ctx.resolved = resolveCreds(ctx.projectRoot, ctx.fleetHome, ctx.env || {});
  });

  registry.define(/^the token and chat id come from the fleet creds file$/, (ctx) => {
    assert.equal(ctx.resolved.botToken, `${ctx.swarmName}-token`);
    assert.equal(ctx.resolved.chatId, `${ctx.swarmName}-chat`);
  });

  registry.define(/^not from the ambient environment$/, (ctx) => {
    assert.notEqual(ctx.resolved.botToken, 'env-token-should-never-be-used');
  });

  // ── per-swarm-telegram-creds-02 ─────────────────────────────────────
  registry.define(/^no fleet creds file exists for swarm "([^"]+)"$/, (ctx, swarmName) => {
    ctx.projectRoot = mkTmp('bl436-project-');
    ctx.fleetHome = mkTmp('bl436-fleet-home-'); // deliberately never written to
    ctx.swarmName = swarmName;
    writeSwarmIdentity(ctx.projectRoot, swarmName);
  });

  registry.define(/^the environment provides a bot token and chat id$/, (ctx) => {
    ctx.env = { TELEGRAM_BOT_TOKEN: 'env-token', TELEGRAM_CHAT_ID: 'env-chat' };
  });

  registry.define(/^the token and chat id come from the environment$/, (ctx) => {
    assert.equal(ctx.resolved.botToken, 'env-token');
    assert.equal(ctx.resolved.chatId, 'env-chat');
  });

  // ── per-swarm-telegram-creds-03 ─────────────────────────────────────
  registry.define(/^a fleet creds file exists for swarm "([^"]+)" with its own bot token$/, (ctx, swarmName) => {
    ctx.projectRoot = mkTmp('bl436-project-');
    ctx.fleetHome = mkTmp('bl436-fleet-home-');
    ctx.swarmName = swarmName;
    writeSwarmIdentity(ctx.projectRoot, swarmName);
    writeFleetCredsFile(ctx.fleetHome, swarmName, { botToken: `${swarmName}-own-token`, chatId: `${swarmName}-own-chat`, bridgePort: 8765 });
  });

  registry.define(/^the launching shell exported the primary swarm's bot token into the environment$/, (ctx) => {
    ctx.env = { TELEGRAM_BOT_TOKEN: 'primary-token-leaked-into-shell', TELEGRAM_CHAT_ID: 'primary-chat-leaked-into-shell' };
  });

  registry.define(/^it uses the creds file's token$/, (ctx) => {
    assert.equal(ctx.resolved.botToken, `${ctx.swarmName}-own-token`);
  });

  registry.define(/^it does not inherit the exported primary token$/, (ctx) => {
    assert.notEqual(ctx.resolved.botToken, 'primary-token-leaked-into-shell');
  });

  // ── per-swarm-telegram-creds-04 ─────────────────────────────────────
  registry.define(/^a fleet creds file exists for swarm "([^"]+)" with a bridge port$/, (ctx, swarmName) => {
    ctx.projectRoot = mkTmp('bl436-project-');
    ctx.fleetHome = mkTmp('bl436-fleet-home-');
    ctx.swarmName = swarmName;
    writeSwarmIdentity(ctx.projectRoot, swarmName);
    writeFleetCredsFile(ctx.fleetHome, swarmName, { botToken: 't', chatId: 'c', bridgePort: 9001 });
  });

  registry.define(/^the front-desk stack for swarm "([^"]+)" resolves its bridge port$/, (ctx, swarmName) => {
    assert.equal(ctx.swarmName, swarmName, 'internal test setup: scenario swarm name mismatch');
    ctx.resolved = resolveCreds(ctx.projectRoot, ctx.fleetHome, {});
  });

  registry.define(/^the bridge port comes from the creds file$/, (ctx) => {
    assert.equal(ctx.resolved.bridgePort, 9001);
  });

  // ── per-swarm-telegram-creds-05 ─────────────────────────────────────
  registry.define(/^channel provisioning detects the group for swarm "([^"]+)"$/, (ctx, swarmName) => {
    ctx.swarmName = swarmName;
    ctx.targetRepoPath = mkTmp('bl436-target-');
    ctx.fleetHome = mkTmp('bl436-fleet-home-');
    ctx.botToken = `${swarmName}-provisioned-token`;
    ctx.bridgePort = 9001;
    ctx.adapters = buildAdapters(
      ctx.targetRepoPath,
      ctx.botToken,
      path.join(mkTmp('bl436-secrets-'), 'secrets.json'),
      ctx.swarmName,
      ctx.bridgePort,
      undefined,
      ctx.fleetHome
    );
  });

  registry.define(/^it persists the channel$/, (ctx) => {
    ctx.adapters.persistChannel('-100999', 42);
  });

  registry.define(/^it writes botToken, chatId, and bridgePort to swarm "([^"]+)"'s fleet creds file$/, (ctx, swarmName) => {
    assert.equal(ctx.swarmName, swarmName, 'internal test setup: scenario swarm name mismatch');
    const written = readFleetTelegramCreds(ctx.fleetHome, swarmName);
    assert.deepEqual(written, { botToken: ctx.botToken, chatId: '-100999', bridgePort: ctx.bridgePort });
  });
}

module.exports = { registerSteps };
