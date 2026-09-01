'use strict';

// BL-1316: a seat's reasoning effort follows the claimed ticket's
// mutation_cost at claim time. Drives REAL ready_for_next_task.bb over a
// single-seat coder fixture (same shape as BL-1001's difficulty-aware seat
// routing fixture, just one seat - this ticket is claim-time effort, not
// seat pick) and asserts on the real launch/coder.claude-settings.json
// file apply-claim-effort! writes.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1316 a seat's reasoning effort follows the claimed ticket's mutation_cost";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROLE = 'coder';

const KNOWN_COSTS = new Set(['low', 'medium', 'high']);
const PACK_DEFAULT_EFFORT = 'medium';

function seatDir(root, role) {
  return path.join(root, role);
}

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function writeConf(root, backend) {
  const dir = path.join(root, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'swarmforge.conf'),
    [`window ${ROLE} ${backend} coder --model claude-sonnet-5 --effort ${PACK_DEFAULT_EFFORT}`, ''].join('\n')
  );
}

function mkFixture(ctx, { backend = 'claude' } = {}) {
  const root = mkSocketFixtureRoot('bl1316-acc-');
  ctx.root = root;
  ctx.backend = backend;
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: gitEnv(),
    });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  const roles = ['specifier', ROLE];
  for (const r of roles) {
    fs.mkdirSync(seatDir(root, r), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    roles.map((r) => `${r}\t${r}-wt\t${seatDir(root, r)}\tswarmforge-${r}\t${r}\tclaude\ttask`).join('\n') + '\n'
  );
  writeConf(root, backend);
  // The seat's launch-time settings file - apply-claim-effort! rewrites
  // this in place, it never creates one from nothing.
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'launch', `${ROLE}.claude-settings.json`),
    JSON.stringify({ model: 'claude-sonnet-5', effortLevel: PACK_DEFAULT_EFFORT }, null, 2)
  );
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['-c', 'core.hooksPath=/dev/null', 'add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed']);
  ctx.commit = git(['rev-parse', '--short=10', 'HEAD']).trim();
  ctx.ticketCounter = 0;
}

function fixtureEnv(root, role) {
  return {
    ...gitEnv(),
    PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    SWARMFORGE_ROLE: role,
  };
}

function writeTicket(ctx, cost) {
  ctx.ticketCounter += 1;
  const id = `BL-931${ctx.ticketCounter}`;
  ctx.task = `${id}-probe`;
  const costLine = cost ? `mutation_cost: ${cost}\n` : '';
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${id}.yaml`),
    `id: ${id}\ntitle: probe\nstatus: active\n${costLine}`
  );
}

function send(ctx) {
  const draft = path.join(seatDir(ctx.root, 'specifier'), `d-${ctx.task}.txt`);
  fs.writeFileSync(
    draft,
    `type: git_handoff\nto: ${ROLE}\npriority: 50\ntask: ${ctx.task}\ncommit: ${ctx.commit}\n`
  );
  const sendOnce = () =>
    spawnSync('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
      cwd: seatDir(ctx.root, 'specifier'),
      encoding: 'utf8',
      timeout: 60000,
      env: fixtureEnv(ctx.root, 'specifier'),
    });
  // Article 2.3's self-audit: the FIRST call against a given draft
  // fingerprint always challenges (AUDIT_REQUIRED / HANDOFF_NOT_QUEUED,
  // exit 0, nothing queued); an identical second call queues it for real.
  let res = sendOnce();
  assert.equal(res.status, 0, `send (audit) failed: ${res.stdout}${res.stderr}`);
  res = sendOnce();
  assert.equal(res.status, 0, `send (queue) failed: ${res.stdout}${res.stderr}`);
}

function claim(ctx) {
  return spawnSync('bb', [path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')], {
    cwd: seatDir(ctx.root, ROLE),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, ROLE),
  });
}

function finishClaim(ctx) {
  // Frees the seat between two claims in the same scenario - this feature
  // is not testing done_with_current_task.bb, just that the seat is idle
  // again, same shape as BL-1001's freeSeat.
  const d = path.join(seatDir(ctx.root, ROLE), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
}

function holdsProbe(ctx) {
  const d = path.join(seatDir(ctx.root, ROLE), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  if (!fs.existsSync(d)) return false;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.handoff'))) {
    const text = fs.readFileSync(path.join(d, f), 'utf8');
    if (text.includes(`task: ${ctx.task}`)) return true;
  }
  return false;
}

function settingsFile(ctx) {
  return path.join(ctx.root, '.swarmforge', 'launch', `${ROLE}.claude-settings.json`);
}

function readEffort(ctx) {
  const text = fs.readFileSync(settingsFile(ctx), 'utf8');
  return JSON.parse(text).effortLevel;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a running seat whose backend exposes a reasoning-effort setting$/, (ctx) => {
    mkFixture(ctx, { backend: 'claude' });
  });

  scoped(/^pack windows may pin a default model without a per-ticket effort$/, () => {
    /* documented by the fixture's own window line (--model + --effort default) */
  });

  scoped(/^a ticket whose mutation_cost is (.+)$/, (ctx, cost) => {
    if (!KNOWN_COSTS.has(cost)) throw new Error(`unknown cost ${cost}`);
    writeTicket(ctx, cost);
    send(ctx);
  });

  scoped(/^a ticket with no mutation_cost field$/, (ctx) => {
    writeTicket(ctx, null);
    send(ctx);
  });

  scoped(/^the seat claims it$/, (ctx) => {
    ctx.beforeSettings = fs.existsSync(settingsFile(ctx)) ? fs.readFileSync(settingsFile(ctx), 'utf8') : null;
    ctx.claimResult = claim(ctx);
    assert.equal(ctx.claimResult.status, 0, `claim failed: ${ctx.claimResult.stdout}${ctx.claimResult.stderr}`);
  });

  scoped(/^the seat's reasoning effort becomes (.+)$/, (ctx, effort) => {
    assert.equal(readEffort(ctx), effort);
  });

  scoped(/^the seat's reasoning effort is unchanged from the pack\/window default$/, (ctx) => {
    assert.equal(readEffort(ctx), PACK_DEFAULT_EFFORT);
  });

  scoped(/^a seat on a backend that exposes no reasoning-effort setting$/, (ctx) => {
    mkFixture(ctx, { backend: 'cursor' });
  });

  scoped(/^no unsupported effort argument is sent to that backend$/, (ctx) => {
    // No lever means apply-claim-effort! never touches the settings file
    // at all - byte-identical before/after the claim.
    const after = fs.readFileSync(settingsFile(ctx), 'utf8');
    assert.equal(after, ctx.beforeSettings, 'settings file must be untouched for a no-lever backend');
  });

  scoped(/^the claim still succeeds$/, (ctx) => {
    assert.ok(holdsProbe(ctx), 'expected the seat to hold the claimed parcel');
  });

  scoped(/^the seat previously claimed a high mutation_cost ticket at high effort$/, (ctx) => {
    mkFixture(ctx, { backend: 'claude' });
    writeTicket(ctx, 'high');
    send(ctx);
    const result = claim(ctx);
    assert.equal(result.status, 0, `first claim failed: ${result.stdout}${result.stderr}`);
    assert.equal(readEffort(ctx), 'high');
    finishClaim(ctx);
  });

  scoped(/^the seat claims a low mutation_cost ticket$/, (ctx) => {
    writeTicket(ctx, 'low');
    send(ctx);
    const result = claim(ctx);
    assert.equal(result.status, 0, `second claim failed: ${result.stdout}${result.stderr}`);
  });
}

module.exports = { registerSteps };
