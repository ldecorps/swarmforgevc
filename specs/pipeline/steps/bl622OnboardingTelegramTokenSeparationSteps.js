'use strict';

// BL-622 (epic fleet-topology): "a swarm never polls Telegram with an
// inherited bot token." Extends BL-436's per-swarm creds file with the
// missing piece: env fallback is now reserved for the ONE recorded primary
// root, every other swarm without its own creds file gets a loud refusal
// instead of silently inheriting the primary's token (human-confirmed
// incident 2026-07-24 - a rival poller stole ~9h of inbound).
//
// Scenarios 01/02/04 drive the REAL fleet_telegram_creds_cli.bb (same
// convention as bl436PerSwarmTelegramCredsSteps.js - the thin CLI over the
// exact resolve-telegram-creds front_desk_supervisor.bb calls at launch).
// Scenario 03 drives the REAL front_desk_supervisor.bb via --check-once (the
// actual "a swarm launches" moment that bootstraps the primary-root record).
// Scenario 05 drives the REAL front_desk_supervisor.bb directly. Scenario 06
// drives the REAL launch_front_desk.sh (the shell gate swarm_ensure.bb's
// front-desk repair action actually runs) against a stale-pid-file fixture.
// Scenario 07 reads the shipped docs. Every fixture uses its own isolated
// HOME/project-root/fleet-home - never the real $HOME.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CREDS_CLI = path.join(SWARM_SCRIPTS, 'fleet_telegram_creds_cli.bb');
const SUPERVISOR = path.join(SWARM_SCRIPTS, 'front_desk_supervisor.bb');
const LAUNCH_FRONT_DESK = path.join(SWARM_SCRIPTS, 'launch_front_desk.sh');
const DOCS_ROOT = path.join(REPO_ROOT, 'docs');

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

function writePrimaryRoot(fleetHome, root) {
  const dir = path.join(fleetHome, '.swarmforge', 'fleet', 'primary');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'root'), root);
}

function readPrimaryRoot(fleetHome) {
  const f = path.join(fleetHome, '.swarmforge', 'fleet', 'primary', 'root');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
}

function resolveCreds(projectRoot, fleetHome, env) {
  const out = execFileSync('bb', [CREDS_CLI, projectRoot], {
    encoding: 'utf8',
    env: { ...process.env, ...env, SWARMFORGE_FLEET_HOME: fleetHome },
  });
  return JSON.parse(out.trim());
}

// Bridge/bot fixtures for a REAL (non-CLI) front_desk_supervisor.bb or
// launch_front_desk.sh invocation - mirrors test_front_desk_supervisor_
// fleet_creds.sh's own make_fixture, stub entrypoints that just stay alive.
function makeLaunchFixture(prefix) {
  const d = mkTmp(prefix);
  fs.mkdirSync(path.join(d, 'extension', 'out', 'tools'), { recursive: true });
  fs.mkdirSync(path.join(d, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(d, 'extension', 'out', 'tools', 'start-bridge-headless.js'), 'setInterval(() => {}, 1000);\n');
  fs.writeFileSync(path.join(d, 'extension', 'out', 'tools', 'telegram-front-desk-bot.js'), 'setInterval(() => {}, 1000);\n');
  return d;
}

function pidFilePath(projectRoot) {
  return path.join(projectRoot, '.swarmforge', 'operator', 'front-desk-supervisor.pid');
}

function logFilePath(projectRoot) {
  return path.join(projectRoot, '.swarmforge', 'operator', 'front-desk-supervisor.log');
}

function flatten(text) {
  return text.replace(/\s+/g, ' ');
}

// front_desk_supervisor.bb spawns its bridge/bot with :out/:err :inherit -
// when this HELPER's own bb invocation is spawnSync'd with the default
// 'pipe' stdio, those grandchildren inherit the SAME pipe file descriptors
// and (being long-running processes that outlive bb itself) hold them open
// forever, so Node's spawnSync - which reads stdout/stderr until EOF - never
// returns even after bb has long since exited. Redirecting to a real FILE
// (exactly what launch_front_desk.sh's own `nohup ... >> "$LOG" 2>&1` does)
// sidesteps this: a file descriptor pointing at a regular file never blocks
// a read waiting for "every writer to close it" the way a pipe does.
function spawnSyncToFile(cmd, args, env) {
  const outFile = path.join(mkTmp('bl622-spawn-out-'), 'out.log');
  const fd = fs.openSync(outFile, 'a');
  try {
    // timeout is defense-in-depth alongside the file-redirect fix above -
    // mirrors onboarderLauncherPidGuard.property.test.js's own use of a
    // spawnSync timeout against the identical class of hang.
    const result = spawnSync(cmd, args, { stdio: ['ignore', fd, fd], env, timeout: 15000 });
    return { status: result.status, error: result.error, output: fs.readFileSync(outFile, 'utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

function registerSteps(registry) {
  // ── BL-622 non-primary-never-inherits-env-token-01 ─────────────────────
  registry.define(/^the recorded primary root names a different project root$/, (ctx) => {
    ctx.projectRoot = mkTmp('bl622-project-');
    ctx.fleetHome = mkTmp('bl622-fleet-home-');
    ctx.swarmName = 'secondary';
    writeSwarmIdentity(ctx.projectRoot, ctx.swarmName);
    writePrimaryRoot(ctx.fleetHome, mkTmp('bl622-other-primary-'));
  });

  registry.define(/^no per-swarm Telegram creds file exists for this swarm$/, () => {
    // Deliberate no-op: the fixture step above never wrote a creds file for
    // ctx.swarmName - asserting a negative by omission, not an action.
  });

  registry.define(/^the ambient environment carries the primary Telegram credentials$/, (ctx) => {
    ctx.env = { TELEGRAM_BOT_TOKEN: 'primary-env-token', TELEGRAM_CHAT_ID: 'primary-env-chat' };
  });

  registry.define(/^Telegram credentials are resolved for this project root$/, (ctx) => {
    ctx.resolved = resolveCreds(ctx.projectRoot, ctx.fleetHome, ctx.env || {});
  });

  registry.define(/^no bot token is resolved$/, (ctx) => {
    assert.equal(ctx.resolved.botToken, null);
  });

  registry.define(/^the front desk does not launch$/, (ctx) => {
    if (ctx.ensureResult) {
      // Scenario 06: the pre-existing STALE pid file must be untouched - no
      // new supervisor ever claimed it with a live pid.
      const content = fs.existsSync(pidFilePath(ctx.projectRoot))
        ? fs.readFileSync(pidFilePath(ctx.projectRoot), 'utf8').trim()
        : null;
      assert.equal(content, ctx.stalePid, 'expected the stale pid file to remain untouched by a refused launch');
    } else {
      assert.equal(ctx.resolved.refused, true);
    }
  });

  registry.define(/^one loud line explains this swarm needs its own token and names the provisioning command$/, (ctx) => {
    assert.ok(ctx.resolved.reason, 'expected a refusal reason');
    assert.ok(ctx.resolved.reason.includes(ctx.swarmName), 'reason should name the swarm');
    assert.ok(
      ctx.resolved.reason.includes('provision-onboarding-telegram-channel.js'),
      'reason should name the provisioning command'
    );
  });

  // ── BL-622 primary-env-fallback-preserved-02 ────────────────────────────
  registry.define(/^this project root is the recorded primary root$/, (ctx) => {
    ctx.projectRoot = mkTmp('bl622-project-');
    ctx.fleetHome = mkTmp('bl622-fleet-home-');
    ctx.swarmName = 'primary';
    writeSwarmIdentity(ctx.projectRoot, ctx.swarmName);
    writePrimaryRoot(ctx.fleetHome, ctx.projectRoot);
  });

  registry.define(/^the ambient token is resolved and the front desk may launch$/, (ctx) => {
    assert.equal(ctx.resolved.botToken, 'primary-env-token');
    assert.equal(ctx.resolved.refused, false);
  });

  // ── BL-622 first-primary-launch-records-root-03 ─────────────────────────
  registry.define(/^no primary root is recorded on this host$/, (ctx) => {
    ctx.projectRoot = makeLaunchFixture('bl622-primary-launch-');
    ctx.fleetHome = mkTmp('bl622-fleet-home-'); // deliberately no primary/root written yet
    writeSwarmIdentity(ctx.projectRoot, 'primary');
  });

  registry.define(/^a swarm launches as swarm name "([^"]+)"$/, (ctx, swarmName) => {
    assert.equal(swarmName, 'primary', 'internal test setup: scenario 03 is the primary-bootstrap case');
    ctx.launchResult = spawnSyncToFile('bb', [SUPERVISOR, ctx.projectRoot, '--check-once'], {
      ...process.env,
      SWARMFORGE_FLEET_HOME: ctx.fleetHome,
      BRIDGE_TOKEN: 'fake-token',
      TELEGRAM_BOT_TOKEN: 'primary-env-token',
      TELEGRAM_CHAT_ID: 'primary-env-chat',
      TELEGRAM_PRINCIPAL_USER_ID: '1',
    });
  });

  registry.define(/^the primary root record is written naming this project root$/, (ctx) => {
    assert.equal(readPrimaryRoot(ctx.fleetHome), ctx.projectRoot);
  });

  // ── BL-622 named-swarm-creds-file-wins-04 ───────────────────────────────
  registry.define(/^a fleet creds file exists for swarm name "([^"]+)" carrying its own token$/, (ctx, swarmName) => {
    ctx.projectRoot = mkTmp('bl622-project-');
    ctx.fleetHome = mkTmp('bl622-fleet-home-');
    ctx.swarmName = swarmName;
    writeSwarmIdentity(ctx.projectRoot, swarmName);
    writeFleetCredsFile(ctx.fleetHome, swarmName, {
      botToken: `${swarmName}-own-token`,
      chatId: `${swarmName}-own-chat`,
      bridgePort: 8765,
    });
  });

  registry.define(/^Telegram credentials are resolved for the fes swarm root$/, (ctx) => {
    ctx.resolved = resolveCreds(ctx.projectRoot, ctx.fleetHome, ctx.env || {});
  });

  registry.define(/^the fes token is resolved and not the ambient token$/, (ctx) => {
    assert.equal(ctx.resolved.botToken, `${ctx.swarmName}-own-token`);
    assert.notEqual(ctx.resolved.botToken, 'primary-env-token');
  });

  // ── BL-622 duplicate-token-refused-05 ───────────────────────────────────
  registry.define(/^the resolved token equals another fleet swarm's recorded token$/, (ctx) => {
    ctx.projectRoot = makeLaunchFixture('bl622-duplicate-');
    ctx.fleetHome = mkTmp('bl622-fleet-home-');
    ctx.swarmName = 'fes2';
    writeSwarmIdentity(ctx.projectRoot, ctx.swarmName);
    writeFleetCredsFile(ctx.fleetHome, 'fes', { botToken: 'shared-token', chatId: 'fes-chat', bridgePort: 9001 });
    writeFleetCredsFile(ctx.fleetHome, ctx.swarmName, { botToken: 'shared-token', chatId: 'fes2-chat', bridgePort: 9002 });
  });

  registry.define(/^the front-desk launch gate runs$/, (ctx) => {
    ctx.gateResult = spawnSyncToFile('bb', [SUPERVISOR, ctx.projectRoot, '--check-once'], {
      ...process.env,
      SWARMFORGE_FLEET_HOME: ctx.fleetHome,
      BRIDGE_TOKEN: 'fake-token',
      TELEGRAM_PRINCIPAL_USER_ID: '1',
    });
  });

  registry.define(/^the launch is refused$/, (ctx) => {
    assert.notEqual(ctx.gateResult.status, 0);
  });

  registry.define(/^one loud line names the conflicting swarm$/, (ctx) => {
    const log = fs.existsSync(logFilePath(ctx.projectRoot)) ? fs.readFileSync(logFilePath(ctx.projectRoot), 'utf8') : '';
    assert.match(flatten(log), /fleet swarm 'fes'/);
  });

  // ── BL-622 pid-file-alone-never-reenables-06 ────────────────────────────
  registry.define(/^a stale front-desk supervisor pid file exists in a non-primary swarm with no creds file$/, (ctx) => {
    ctx.projectRoot = makeLaunchFixture('bl622-stale-pid-');
    ctx.fleetHome = mkTmp('bl622-fleet-home-');
    ctx.swarmName = 'secondary';
    writeSwarmIdentity(ctx.projectRoot, ctx.swarmName);
    ctx.stalePid = '999999999';
    fs.writeFileSync(pidFilePath(ctx.projectRoot), ctx.stalePid);
  });

  registry.define(/^swarm ensure evaluates front-desk enablement$/, (ctx) => {
    // The exact command swarm_ensure.bb's front-desk-enabled?/ensure-front-
    // desk! runs when a stale pid file alone makes the component eligible
    // for repair (SWARM_ENSURE_FRONT_DESK_CMD's default).
    ctx.ensureResult = spawnSyncToFile('bash', [LAUNCH_FRONT_DESK, ctx.projectRoot], {
      ...process.env,
      SWARMFORGE_FLEET_HOME: ctx.fleetHome,
      TELEGRAM_PRINCIPAL_USER_ID: '1',
    });
  });

  registry.define(/^the loud needs-own-token line is logged$/, (ctx) => {
    const log = fs.existsSync(logFilePath(ctx.projectRoot)) ? fs.readFileSync(logFilePath(ctx.projectRoot), 'utf8') : '';
    assert.ok(log.includes(ctx.swarmName), `expected the log to mention '${ctx.swarmName}': ${log}`);
    assert.match(flatten(log), /own/i);
  });

  // ── BL-622 bringup-docs-stop-exporting-primary-token-07 ─────────────────
  // "the shipped repository documentation" is a genuinely generic Given text
  // several tickets already register as a no-op (bl617, bl623) - the first
  // registration wins the match (stepRegistry.js is first-match-across-
  // registrations), so this file deliberately does NOT redefine it and
  // instead does its real doc reads in the (BL-622-specific) When step below.
  registry.define(/^the second-swarm bring-up how-to and the onboarding tutorial are read$/, (ctx) => {
    ctx.bl439Doc = fs.readFileSync(path.join(DOCS_ROOT, 'how-to', 'BL-439-fes-second-swarm-bringup.md'), 'utf8');
    ctx.onboardingDoc = fs.readFileSync(path.join(DOCS_ROOT, 'tutorials', 'Onboarding-New-Project.md'), 'utf8');
  });

  registry.define(/^they instruct provisioning a distinct per-swarm token before enabling the front desk$/, (ctx) => {
    assert.ok(
      ctx.bl439Doc.includes('provision-onboarding-telegram-channel.js'),
      'BL-439 how-to should name the per-swarm provisioning command'
    );
    assert.ok(
      ctx.onboardingDoc.includes('provision-onboarding-telegram-channel.js'),
      'onboarding tutorial should name the per-swarm provisioning command'
    );
  });

  registry.define(/^they no longer instruct launching from a shell with the primary token exported$/, (ctx) => {
    const flatBl439 = flatten(ctx.bl439Doc);
    assert.ok(
      !/from a shell that still has the \*\*primary's\*\* `TELEGRAM_BOT_TOKEN`\s*exported/i.test(flatBl439),
      'BL-439 how-to should no longer instruct launching with the primary token exported'
    );
    const flatOnboarding = flatten(ctx.onboardingDoc);
    assert.ok(
      !/shell that still has the primary/i.test(flatOnboarding),
      'onboarding tutorial should not instruct launching with the primary token exported'
    );
  });
}

module.exports = { registerSteps };
