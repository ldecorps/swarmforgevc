'use strict';

// BL-1001: difficulty-aware seat claim. Drives REAL ready_for_next_task.bb
// over a two-seat coder fixture with --seat-tier declarations.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'A stage\'s seats are chosen by ticket difficulty, not by whichever is idle';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const HARD = 'coder';
const EASY = 'coder@sonnet2';
const STAGE = 'coder';

const KNOWN_COSTS = new Set(['low', 'medium', 'high']);
const KNOWN_SEATS = new Set(['hard', 'easy-only']);

function seatDir(root, role) {
  return path.join(root, role.replace('@', '-'));
}

function seatLabelToId(label) {
  if (label === 'hard') return HARD;
  if (label === 'easy-only') return EASY;
  throw new Error(`unknown seat label ${label}`);
}

function writeConf(root, { hardTier = 'hard', easyTier = 'easy' } = {}) {
  const dir = path.join(root, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'swarmforge.conf'),
    [
      `window ${HARD} claude coder --model claude-fable-5 --seat-tier ${hardTier}`,
      `window ${EASY} claude coder-sonnet2 --model claude-sonnet-5 --seat-tier ${easyTier}`,
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

function mkFixture(ctx) {
  const root = mkSocketFixtureRoot('bl1001-acc-');
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
  writeConf(root);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['-c', 'core.hooksPath=/dev/null', 'add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed']);
  ctx.commit = git(['rev-parse', '--short=10', 'HEAD']).trim();
  ctx.tiers = { hard: 'hard', easy: 'easy' };
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
  const ids = { low: 'BL-9101', medium: 'BL-9102', high: 'BL-9103' };
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

function inProcess(ctx, role) {
  const d = path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.handoff'));
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

function freeSeat(ctx, role) {
  const d = path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  for (const f of fs.readdirSync(d)) {
    fs.unlinkSync(path.join(d, f));
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a stage with two seats, one declared for hard work and one declared easy-only$/, (ctx) => {
    mkFixture(ctx);
  });

  scoped(/^a ticket whose mutation_cost is (.+)$/, (ctx, cost) => {
    if (!KNOWN_COSTS.has(cost)) throw new Error(`unknown cost ${cost}`);
    writeTicket(ctx, cost);
    send(ctx);
  });

  scoped(/^the hard seat is busy$/, (ctx) => {
    occupy(ctx, HARD);
  });

  scoped(/^the easy-only seat is busy$/, (ctx) => {
    occupy(ctx, EASY);
  });

  scoped(/^the easy-only seat is idle$/, () => {
    /* default */
  });

  scoped(/^the hard seat is idle$/, () => {
    /* default */
  });

  scoped(/^the two seats' declared tiers are exchanged$/, (ctx) => {
    writeConf(ctx.root, { hardTier: 'easy', easyTier: 'hard' });
    ctx.tiers = { hard: 'easy', easy: 'hard' };
  });

  scoped(/^the stage claims it$/, (ctx) => {
    // Poll easy first then hard (and reverse later if needed) — both idle
    // seats get a chance; defer-better-fit leaves low for easy.
    ctx.pollEasy = poll(ctx, EASY);
    ctx.pollHard = poll(ctx, HARD);
  });

  scoped(/^the (.+) seat holds it$/, (ctx, label) => {
    if (!KNOWN_SEATS.has(label)) throw new Error(`unknown seat ${label}`);
    // "hard" / "easy-only" follow the DECLARED tier (invariant 2).
    const physicalHardHasHardTier = ctx.tiers.hard === 'hard';
    const holder =
      label === 'hard'
        ? physicalHardHasHardTier
          ? HARD
          : EASY
        : physicalHardHasHardTier
          ? EASY
          : HARD;
    assert.ok(
      holdsProbe(ctx, holder),
      `expected ${holder} (${label}) to hold claim; hard=${holdsProbe(ctx, HARD)} easy=${holdsProbe(ctx, EASY)}`
    );
    const other = holder === HARD ? EASY : HARD;
    assert.equal(holdsProbe(ctx, other), false, `peer ${other} must not hold it`);
  });

  scoped(/^no seat holds it$/, (ctx) => {
    assert.equal(holdsProbe(ctx, HARD), false);
    assert.equal(holdsProbe(ctx, EASY), false);
  });

  scoped(/^the hard seat holds it once it frees$/, (ctx) => {
    freeSeat(ctx, HARD);
    poll(ctx, EASY);
    poll(ctx, HARD);
    assert.ok(holdsProbe(ctx, HARD), 'hard should claim after free');
    assert.equal(holdsProbe(ctx, EASY), false);
  });
}

module.exports = { registerSteps };
