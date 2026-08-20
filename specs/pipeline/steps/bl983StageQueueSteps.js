'use strict';

// BL-983: step handlers for "a parcel addressed to a stage is worked by
// exactly one of its seats". Every scenario drives the REAL machinery over
// a fixture root: swarm_handoff.bb sends (stage-addressed), the reworked
// ready_for_next_task.bb claims (seat pulls from the stage queue into its
// own in_process), and a real forward from the claiming seat. In the pull
// model "delivered the parcel" means "holds the claim after both seats
// polled" - the stage queue is the address, the claim is the delivery.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-983 a parcel addressed to a stage is worked by exactly one of its seats';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const STAGE = 'coder';
const SEAT2 = 'coder@fable';
const NEXT_STAGE = 'cleaner';

function seatDir(root, role) {
  return path.join(root, role.replace('@', '-'));
}

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl983-acc-'));
  ctx.root = root;
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'F.yaml'), 'id: F\n');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const roles = ['specifier', STAGE, SEAT2, NEXT_STAGE];
  for (const r of roles) {
    fs.mkdirSync(seatDir(root, r), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    roles.map((r) => `${r}\t${r.replace('@', '-')}-wt\t${seatDir(root, r)}\tswarmforge-${r}\t${r}\tclaude\ttask`).join('\n') + '\n'
  );
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'tmux'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(root, 'bin', 'tmux'), 0o755);
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  git(['add', '-A']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed']);
  ctx.commit = git(['rev-parse', '--short=10', 'HEAD']).trim();
  ctx.sent = [];
}

function fixtureEnv(root, role) {
  return { PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME, SWARMFORGE_ROLE: role };
}

function send(ctx, task, to = STAGE, fromRole = 'specifier') {
  const draft = path.join(seatDir(ctx.root, fromRole), `d-${task}.txt`);
  fs.writeFileSync(draft, `type: git_handoff\nto: ${to}\npriority: 50\ntask: ${task}\ncommit: ${ctx.commit}\n`);
  const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
    cwd: seatDir(ctx.root, fromRole),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, fromRole),
  });
  assert.equal(res.status, 0, `send of ${task} failed: ${res.stdout}${res.stderr}`);
  ctx.sent.push(task);
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
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : [];
}

function stageQueue(ctx) {
  const d = path.join(seatDir(ctx.root, STAGE), '.swarmforge', 'handoffs', 'inbox', 'new');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : [];
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a stage with two seats, each booted with its own worktree and mailbox$/, (ctx) => {
    mkFixture(ctx);
  });
  scoped(/^both seats of the stage are idle$/, (ctx) => {
    assert.deepEqual(inProcess(ctx, STAGE), [], 'bare seat must start idle');
    assert.deepEqual(inProcess(ctx, SEAT2), [], 'second seat must start idle');
  });

  scoped(/^a parcel addressed to that stage is delivered$/, (ctx) => {
    send(ctx, `BL-501-one`);
    poll(ctx, STAGE);
    poll(ctx, SEAT2);
  });
  scoped(/^exactly one seat is delivered the parcel$/, (ctx) => {
    const holders = [STAGE, SEAT2].filter((s) => inProcess(ctx, s).length > 0);
    assert.equal(holders.length, 1, `exactly one seat must hold the parcel, holders: ${holders}`);
    ctx.holder = holders[0];
  });
  // Shared by scenarios 01 and 05 (same step text, one registration -
  // stepRegistry.resolve is first-match). Scenario 05 (redelivery,
  // ctx.claimedBasename set) asserts the PEER never claimed the copy and
  // leaves the fixture for its final step; scenario 01 asserts the
  // non-holder is empty and is the scenario's last step, so it cleans up.
  scoped(/^the other seat is delivered nothing$/, (ctx) => {
    if (ctx.claimedBasename) {
      assert.ok(
        !inProcess(ctx, STAGE).includes(ctx.claimedBasename),
        `the peer seat must not claim the redelivered copy: ${inProcess(ctx, STAGE)}`
      );
      return;
    }
    try {
      const other = ctx.holder === STAGE ? SEAT2 : STAGE;
      assert.deepEqual(inProcess(ctx, other), [], 'the other seat must hold nothing');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^two parcels addressed to that stage are delivered$/, (ctx) => {
    send(ctx, 'BL-502-a');
    send(ctx, 'BL-503-b');
    poll(ctx, STAGE);
    poll(ctx, SEAT2);
  });
  scoped(/^each seat holds one of the two parcels$/, (ctx) => {
    try {
      assert.equal(inProcess(ctx, STAGE).length, 1, 'bare seat must hold one parcel');
      assert.equal(inProcess(ctx, SEAT2).length, 1, 'second seat must hold one parcel');
      assert.deepEqual(stageQueue(ctx), [], 'the stage queue must be drained');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^every seat of the stage already holds a claimed parcel$/, (ctx) => {
    send(ctx, 'BL-504-a');
    send(ctx, 'BL-505-b');
    poll(ctx, STAGE);
    poll(ctx, SEAT2);
    assert.equal(inProcess(ctx, STAGE).length, 1, 'setup: bare seat busy');
    assert.equal(inProcess(ctx, SEAT2).length, 1, 'setup: second seat busy');
  });
  scoped(/^the parcel is still queued for the stage$/, (ctx) => {
    // The When re-polled both seats; the third parcel must have survived.
    poll(ctx, STAGE);
    poll(ctx, SEAT2);
    assert.equal(stageQueue(ctx).length, 1, `the third parcel must stay queued for the stage: ${stageQueue(ctx)}`);
  });
  scoped(/^no seat holds two claimed parcels$/, (ctx) => {
    try {
      assert.equal(inProcess(ctx, STAGE).length, 1, 'bare seat must still hold exactly one');
      assert.equal(inProcess(ctx, SEAT2).length, 1, 'second seat must still hold exactly one');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^one seat of the stage holds a claimed parcel$/, (ctx) => {
    send(ctx, 'BL-506-x');
    // The SECOND seat claims it - the seat whose identity must not leak.
    poll(ctx, SEAT2);
    assert.equal(inProcess(ctx, SEAT2).length, 1, 'setup: the second seat holds the claim');
    ctx.claimedBasename = inProcess(ctx, SEAT2)[0];
  });
  scoped(/^that seat forwards its work onward$/, (ctx) => {
    const draft = path.join(seatDir(ctx.root, SEAT2), 'fwd.txt');
    fs.writeFileSync(draft, `type: git_handoff\nto: ${NEXT_STAGE}\npriority: 50\ntask: BL-506-x\ncommit: ${ctx.commit}\n`);
    const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
      cwd: seatDir(ctx.root, SEAT2),
      encoding: 'utf8',
      timeout: 60000,
      env: fixtureEnv(ctx.root, SEAT2),
    });
    assert.equal(res.status, 0, `forward failed: ${res.stdout}${res.stderr}`);
  });
  scoped(/^the parcel is addressed to the next stage$/, (ctx) => {
    const d = path.join(seatDir(ctx.root, NEXT_STAGE), '.swarmforge', 'handoffs', 'inbox', 'new');
    const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : [];
    assert.equal(files.length, 1, `the next stage must receive the forward: ${files}`);
    ctx.forwarded = path.join(d, files[0]);
    const content = fs.readFileSync(ctx.forwarded, 'utf8');
    assert.match(content, new RegExp(`^to: ${NEXT_STAGE}$`, 'm'), `forward must address the next stage:\n${content}`);
  });
  scoped(/^no seat of its own stage is addressed$/, (ctx) => {
    try {
      const content = fs.readFileSync(ctx.forwarded, 'utf8');
      assert.ok(!content.includes('@'), `no seat id may appear anywhere in the parcel (invariant 3):\n${content}`);
      assert.ok(!path.basename(ctx.forwarded).includes('@'), `no seat id may appear in the filename: ${ctx.forwarded}`);
      assert.match(content, /^from: coder$/m, 'the from header must be the STAGE');
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the same parcel is delivered again$/, (ctx) => {
    // Redelivery: the identical envelope (same basename) lands in the
    // stage queue again, then the PEER seat polls.
    const src = path.join(seatDir(ctx.root, SEAT2), '.swarmforge', 'handoffs', 'inbox', 'in_process', ctx.claimedBasename);
    const dest = path.join(seatDir(ctx.root, STAGE), '.swarmforge', 'handoffs', 'inbox', 'new', ctx.claimedBasename);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    ctx.peerPoll = poll(ctx, STAGE);
  });
  scoped(/^the claiming seat still holds exactly one copy$/, (ctx) => {
    try {
      const copies = inProcess(ctx, SEAT2).filter((f) => f === ctx.claimedBasename);
      assert.equal(copies.length, 1, `the claimant must hold exactly one copy: ${inProcess(ctx, SEAT2)}`);
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
