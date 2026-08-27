'use strict';

// BL-1004: step handlers for "a stage queue hands a rework only to a seat
// that can work it safely". Every scenario drives the REAL machinery over a
// fixture root: swarm_handoff.bb sends a stage-addressed git_handoff, a
// seeded completed/ parcel is the durable record of the task's prior
// worker, and the reworked ready_for_next_task.bb decides at the claim.
// The fixture calls the LEAF (ready_for_next_task.bb) with cwd inside the
// fixture, never the real ready_for_next.sh dispatcher - the dispatcher
// cds to the real scripts tree and would claim LIVE mailboxes (BL-998);
// the dispatcher-to-leaf hop is qa_e2e_procedure step 8's by-hand check on
// a real install.
//
// "That parcel has waited past the cross-seat claim deadline" advances the
// pinned fixture clock by BACK-DATING the parcel's own enqueued_at/
// created_at headers (the age source the decision reads; file mtime is
// never consulted) - no real sleep, no wall-clock override.
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
// BL-1002/BL-948 gate: this file references a control socket, so fixture
// roots come from the shared short-base helper, never os.tmpdir().
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'A stage queue hands a rework only to a seat that can work it safely';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const TASK = 'BL-901-rework';
const AGED_INSTANT = '2020-01-01T00:00:00Z';

// Explicit known values per the Scenario Outline handler rule: each
// substituted parameter is validated against the closed set the feature's
// Examples (and the literal scenarios 02/03) actually use - a row the
// handlers do not know is a hard failure, never a passthrough.
const KNOWN_PRIORS = new Set(['coder@sonnet2', 'cleaner', 'none']);
const KNOWN_ASKERS = new Set(['coder', 'coder@sonnet2', 'cleaner']);

function seatDir(root, role) {
  return path.join(root, role.replace('@', '-'));
}

function mkFixture(ctx, { stage, seats }) {
  const root = mkSocketFixtureRoot('bl1004-acc-');
  ctx.root = root;
  ctx.stage = stage;
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const roles = ['specifier', ...seats];
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
}

function fixtureEnv(root, role) {
  return { PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, HOME: process.env.HOME, SWARMFORGE_ROLE: role };
}

function send(ctx, task) {
  const draft = path.join(seatDir(ctx.root, 'specifier'), `d-${task}.txt`);
  fs.writeFileSync(draft, `type: git_handoff\nto: ${ctx.stage}\npriority: 50\ntask: ${task}\ncommit: ${ctx.commit}\n`);
  const res = spawnSync('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
    cwd: seatDir(ctx.root, 'specifier'),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, 'specifier'),
  });
  assert.equal(res.status, 0, `send of ${task} failed: ${res.stdout}${res.stderr}`);
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
  const d = path.join(seatDir(ctx.root, ctx.stage), '.swarmforge', 'handoffs', 'inbox', 'new');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : [];
}

// The durable record BL-1004 reads: a git_handoff for the task in the prior
// worker's completed/. Seeded directly - fixture state, not a send.
function seedPriorWork(ctx, seat, task) {
  const d = path.join(seatDir(ctx.root, seat), '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, `50_20260820T000000Z_000001_from_hardender_to_${ctx.stage}_for_${ctx.stage}.handoff`),
    `id: 20260820T000000Z_000001_from_hardender\nfrom: hardender\nto: ${ctx.stage}\nrecipient: ${ctx.stage}\npriority: 50\ntype: git_handoff\ntask: ${task}\ncommit: ${ctx.commit}\ncreated_at: 2026-08-20T00:00:00Z\n\nmerge_and_process hardender ${ctx.commit}\n`
  );
}

function backdateQueuedParcel(ctx) {
  const queued = stageQueue(ctx);
  assert.equal(queued.length, 1, `exactly one parcel must be queued to back-date: ${queued}`);
  const file = path.join(seatDir(ctx.root, ctx.stage), '.swarmforge', 'handoffs', 'inbox', 'new', queued[0]);
  const aged = fs
    .readFileSync(file, 'utf8')
    .replace(/^(enqueued_at|created_at): .*$/gm, `$1: ${AGED_INSTANT}`);
  assert.match(aged, new RegExp(`^created_at: ${AGED_INSTANT}$`, 'm'), 'back-dating must reach at least created_at');
  fs.writeFileSync(file, aged);
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a swarm where a parcel addresses a stage and a seat claims from that stage's queue$/, () => {
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')), 'claim path script must exist');
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIR, 'seat_affinity_lib.bb')), 'seat affinity lib must exist');
  });

  scoped(/^the coder stage has two seats, coder and coder@sonnet2$/, (ctx) => {
    mkFixture(ctx, { stage: 'coder', seats: ['coder', 'coder@sonnet2'] });
  });
  scoped(/^the cleaner stage has one seat$/, (ctx) => {
    mkFixture(ctx, { stage: 'cleaner', seats: ['cleaner'] });
  });

  scoped(/^the stage queue holds a git_handoff for a task$/, (ctx) => {
    try {
      send(ctx, TASK);
      assert.equal(stageQueue(ctx).length, 1, `the parcel must reach the stage queue: ${stageQueue(ctx)}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the prior worker of that task is (\S+)$/, (ctx, prior) => {
    try {
      assert.ok(KNOWN_PRIORS.has(prior), `unknown prior worker "${prior}" - the handlers know ${[...KNOWN_PRIORS]}`);
      if (prior !== 'none') seedPriorWork(ctx, prior, TASK);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^that parcel has waited past the cross-seat claim deadline$/, (ctx) => {
    try {
      ctx.pastDeadline = true;
      backdateQueuedParcel(ctx);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^seat (\S+) asks for its next task$/, (ctx, asking) => {
    try {
      assert.ok(KNOWN_ASKERS.has(asking), `unknown asking seat "${asking}" - the handlers know ${[...KNOWN_ASKERS]}`);
      ctx.asking = asking;
      ctx.poll = poll(ctx, asking);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the parcel (stays in the stage queue|is claimed by that seat)$/, (ctx, outcome) => {
    const out = `${ctx.poll.stdout}\n${ctx.poll.stderr}`;
    const finish = () => {
      if (!ctx.pastDeadline) cleanup(ctx);
    };
    try {
      if (outcome === 'stays in the stage queue') {
        assert.equal(stageQueue(ctx).length, 1, `the parcel must still sit in the stage queue:\n${out}`);
        assert.deepEqual(inProcess(ctx, ctx.asking), [], `the asking seat must claim nothing:\n${out}`);
        // The property's out-loud half: a declined claim says so.
        assert.match(out, /DEFERRED sibling-rework/, `the deferral must be said out loud:\n${out}`);
        // Invariant 2 at the wiring level: the diagnostic names no seat.
        assert.ok(!out.includes('coder@sonnet2'), `no seat id may appear in the claim output:\n${out}`);
      } else {
        assert.equal(inProcess(ctx, ctx.asking).length, 1, `the asking seat must hold the claim:\n${out}`);
        assert.deepEqual(stageQueue(ctx), [], `the stage queue must be drained:\n${out}`);
      }
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
    finish();
  });

  scoped(/^the claim tells the seat it did not build this parcel$/, (ctx) => {
    try {
      const out = `${ctx.poll.stdout}\n${ctx.poll.stderr}`;
      assert.match(out, /did not build/, `the cross-seat claim must say the seat did not build this parcel:\n${out}`);
      assert.ok(!out.includes('coder@sonnet2'), `no seat id may appear in the claim output:\n${out}`);
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
