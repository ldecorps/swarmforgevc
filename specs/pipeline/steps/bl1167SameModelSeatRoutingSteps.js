'use strict';

// BL-1167: same-model stage seats bypass tier filtering. Drives REAL
// ready_for_next_task.bb over a two-seat coder fixture mirroring cursor-forge.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'Same-model stage seats bypass tier filtering';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const HARD = 'coder';
const EASY = 'coder@cursor2';
const STAGE = 'coder';

const KNOWN_COSTS = new Set(['low', 'medium', 'high']);

function seatDir(root, role) {
  return path.join(root, role.replace('@', '-'));
}

function writeConf(root, { hardModel = 'auto', easyModel = 'auto' } = {}) {
  const dir = path.join(root, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'swarmforge.conf'),
    [
      `window ${HARD} claude coder --model ${hardModel} --seat-tier hard`,
      `window ${EASY} claude coder-cursor2 --model ${easyModel} --seat-tier easy`,
      '',
    ].join('\n')
  );
}

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function mkFixture(ctx, { hardModel = 'auto', easyModel = 'auto' } = {}) {
  const root = mkSocketFixtureRoot('bl1167-acc-');
  ctx.root = root;
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: gitEnv(),
    });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const roles = ['specifier', HARD, EASY];
  for (const r of roles) {
    fs.mkdirSync(seatDir(root, r), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    roles.map((r) => `${r}\t${r.replace('@', '-')}-wt\t${seatDir(root, r)}\tswarmforge-${r}\t${r}\tclaude\ttask`).join('\n') + '\n'
  );
  writeConf(root, { hardModel, easyModel });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['-c', 'core.hooksPath=/dev/null', 'add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed']);
  ctx.commit = git(['rev-parse', '--short=10', 'HEAD']).trim();
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
  const ids = { low: 'BL-9167', medium: 'BL-9168', high: 'BL-9169' };
  const id = ids[cost];
  ctx.ticketId = id;
  ctx.task = `${id}-probe`;
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${id}.yaml`),
    `id: ${id}\ntitle: probe\nstatus: active\nmutation_cost: ${cost}\n`
  );
}

function send(ctx) {
  const draft = path.join(seatDir(ctx.root, 'specifier'), `d-${ctx.task}.txt`);
  fs.writeFileSync(
    draft,
    `type: git_handoff\nto: ${STAGE}\npriority: 50\ntask: ${ctx.task}\ncommit: ${ctx.commit}\n`
  );
  const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
    cwd: seatDir(ctx.root, 'specifier'),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, 'specifier'),
  });
  assert.equal(res.status, 0, `send failed: ${res.stdout}${res.stderr}`);
}

function poll(ctx, role) {
  return spawnSync('bb', [path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')], {
    cwd: seatDir(ctx.root, role),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, role),
  });
}

function holdsProbe(ctx, role) {
  const d = path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  if (!fs.existsSync(d)) return false;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.handoff'))) {
    const text = fs.readFileSync(path.join(d, f), 'utf8');
    if (text.includes(`task: ${ctx.task}`)) return true;
  }
  return false;
}

function occupy(ctx, role) {
  const d = path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, '50_busy.handoff'),
    'id: busy\nfrom: x\nto: coder\nrecipient: coder\npriority: 50\ntype: note\nmessage: busy\n'
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a coder stage with two seats both declared for the same model$/, (ctx) => {
    mkFixture(ctx, { hardModel: 'auto', easyModel: 'auto' });
  });

  scoped(/^a ticket whose mutation_cost is (.+)$/, (ctx, cost) => {
    if (!KNOWN_COSTS.has(cost)) throw new Error(`unknown cost ${cost}`);
    writeTicket(ctx, cost);
    send(ctx);
  });

  scoped(/^both coder seats are idle$/, () => {
    /* default fixture state */
  });

  scoped(/^the hard-tier seat is busy$/, (ctx) => {
    occupy(ctx, HARD);
  });

  scoped(/^the easy-tier seat is idle$/, () => {
    /* default */
  });

  scoped(/^the two coder seats declare different models$/, (ctx) => {
    writeConf(ctx.root, { hardModel: 'auto', easyModel: 'claude-sonnet-5' });
  });

  scoped(/^the easy-tier seat polls for work$/, (ctx) => {
    ctx.pollEasy = poll(ctx, EASY);
  });

  scoped(/^that seat may claim the ticket$/, (ctx) => {
    assert.ok(
      holdsProbe(ctx, EASY),
      `expected ${EASY} to hold claim; stdout=${ctx.pollEasy.stdout}${ctx.pollEasy.stderr}`
    );
  });

  scoped(/^that seat must not claim the ticket$/, (ctx) => {
    assert.equal(holdsProbe(ctx, EASY), false, 'easy seat must not claim when models differ');
    assert.match(ctx.pollEasy.stdout, /NO_TASK|ROTATE_HOME/, 'poll should report no claim');
  });
}

module.exports = { registerSteps };
