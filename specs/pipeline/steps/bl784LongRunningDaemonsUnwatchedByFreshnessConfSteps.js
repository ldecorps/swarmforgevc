'use strict';

// BL-784: step handlers for supervisor freshness heartbeats and registry guard.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CHECKER = path.join(SCRIPT_DIR, 'daemon_log_freshness_check.sh');
const GUARD = path.join(SCRIPT_DIR, 'daemon_log_freshness_registry_guard.sh');
const CONF = path.join(SCRIPT_DIR, 'test', 'fixtures', 'daemon_log_freshness.fixture.conf');
const REQUIRED = path.join(SCRIPT_DIR, 'daemon_log_freshness_required.conf');
const FEATURE = 'long-running daemons unwatched by freshness conf';

function runGuard(env) {
  const result = spawnSync('/bin/sh', [GUARD], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function runChecker(root, nowEpoch) {
  const result = spawnSync('/bin/sh', [CHECKER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FRESHNESS_ROOT: root,
      FRESHNESS_CONF: CONF,
      FRESHNESS_NOW_EPOCH: String(nowEpoch),
      FRESHNESS_LOAD: '1',
      FRESHNESS_CORES: '1',
    },
  });
  return { status: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function registerSteps(registry) {
  registry.defineScoped(/^the shipped daemon_log_freshness fixture conf$/, (ctx) => {
    ctx.bl784 = { guardEnv: { FRESHNESS_CONF: CONF, FRESHNESS_REQUIRED: REQUIRED } };
  }, FEATURE);

  registry.defineScoped(/^a required daemon list that includes an unregistered name$/, (ctx) => {
    const reqPath = path.join(REPO_ROOT, 'tmp', `bl784-required-${Date.now()}.conf`);
    fs.mkdirSync(path.dirname(reqPath), { recursive: true });
    fs.writeFileSync(reqPath, 'handoffd\nbabysitterd\nfixture_unregistered_daemon\n');
    ctx.bl784 = {
      guardEnv: { FRESHNESS_CONF: CONF, FRESHNESS_REQUIRED: reqPath },
      reqPath,
    };
  }, FEATURE);

  registry.defineScoped(/^the registry guard runs$/, (ctx) => {
    ctx.bl784.guardResult = runGuard(ctx.bl784.guardEnv);
  }, FEATURE);

  registry.defineScoped(/^the guard exits successfully$/, (ctx) => {
    if (ctx.bl784.guardResult.status !== 0) {
      throw new Error(`registry guard failed: ${ctx.bl784.guardResult.output}`);
    }
  }, FEATURE);

  registry.defineScoped(/^the guard names the unregistered daemon$/, (ctx) => {
    if (!ctx.bl784.guardResult.output.includes('fixture_unregistered_daemon')) {
      throw new Error(`expected unregistered daemon named: ${ctx.bl784.guardResult.output}`);
    }
    if (ctx.bl784.guardResult.status === 0) {
      throw new Error('expected guard to fail for missing row');
    }
  }, FEATURE);

  registry.defineScoped(/^a handoffd_supervisor with a fresh heartbeat log$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(REPO_ROOT, 'tmp', 'bl784-root-'));
    const now = 1700000000;
    const ts = new Date(now * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const dirs = [
      path.join(root, '.swarmforge', 'daemon'),
      path.join(root, '.swarmforge', 'babysitterd'),
      path.join(root, 'kills'),
      path.join(root, 'starts'),
      path.join(root, 'announces'),
    ];
    dirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));
    for (const rel of [
      '.swarmforge/daemon/handoffd.log',
      '.swarmforge/babysitterd/babysitterd.log',
      '.swarmforge/daemon/handoffd-supervisor.log',
    ]) {
      fs.writeFileSync(path.join(root, rel), `${ts} heartbeat\n`);
    }
    fs.writeFileSync(path.join(root, '.swarmforge/daemon/handoffd-supervisor.pid'), `${process.pid}\n`);
    ctx.bl784 = { root, now };
  }, FEATURE);

  registry.defineScoped(/^the freshness checker runs against the fixture conf$/, (ctx) => {
    ctx.bl784.checkerResult = runChecker(ctx.bl784.root, ctx.bl784.now);
  }, FEATURE);

  registry.defineScoped(/^the supervisor process is not killed$/, (ctx) => {
    const kills = path.join(ctx.bl784.root, 'kills.log');
    if (fs.existsSync(kills) && fs.readFileSync(kills, 'utf8').trim()) {
      throw new Error(`checker killed supervisor: ${fs.readFileSync(kills, 'utf8')}`);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
