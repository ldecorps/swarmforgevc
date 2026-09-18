'use strict';

// BL-1616: step handlers for "A ticket built from a Work note counts as
// worked by that seat". Follows bl1004ReworkClaimSteps.js's own fixture
// shape (the ticket's own direction: extend BL-1004's handler fixture) -
// every scenario drives the REAL ready_for_next_task.bb over a fixture
// roster, with a completed WORK NOTE (never a git_handoff) as the prior
// worker's durable record, since that is exactly the shape BL-1004's own
// fixture did not cover and this ticket exists to close.
//
// "That parcel has waited past the cross-seat claim deadline" advances the
// pinned fixture clock by BACK-DATING the parcel's own enqueued_at/
// created_at headers - no real sleep, no wall-clock override (BL-1004's own
// convention).
//
// Invariant 1 (BL-968) applies: module load is requires and pure constants
// only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { sendGitHandoffTwoCall } = require('./lib/sendGitHandoffTwoCall');

const FEATURE = 'BL-1616 A ticket built from a Work note counts as worked by that seat';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const STAGE = 'coder';
const SEAT2 = 'coder@2';
const TICKET = 'BL-0042';
const AGED_INSTANT = '2020-01-01T00:00:00Z';

function seatDir(root, role) {
  return path.join(root, role.replace('@', '-'));
}

function mkFixture(ctx, seats) {
  const root = mkSocketFixtureRoot('bl1616-acc-');
  ctx.root = root;
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const roles = ['specifier', ...seats];
  for (const r of roles) fs.mkdirSync(seatDir(root, r), { recursive: true });
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
  fs.writeFileSync(draft, `type: git_handoff\nto: ${STAGE}\npriority: 50\ntask: ${task}\ncommit: ${ctx.commit}\n`);
  const res = sendGitHandoffTwoCall('bb', [path.join(SCRIPTS_DIR, 'swarm_handoff.bb'), draft], {
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
  const d = path.join(seatDir(ctx.root, STAGE), '.swarmforge', 'handoffs', 'inbox', 'new');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : [];
}

// The durable record this ticket adds: a completed WORK NOTE (never a
// git_handoff) naming ticket in its message, in the given seat's
// completed/. Seeded directly - fixture state, not a real dispatch/
// completion round trip. noWorkReason, when given, stamps the header
// done_with_current.sh's --no-work path writes.
function seedCompletedWorkNote(ctx, seat, { ticket, noWorkReason } = {}) {
  const d = path.join(seatDir(ctx.root, seat), '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(d, { recursive: true });
  const message = ticket ? `Work ${ticket}: read backlog/active` : 'branch behind abc1234567: dirty worktree - merge up';
  const lines = [
    'id: 20260817T000000Z_000001_from_coordinator',
    'from: coordinator',
    `to: ${seat}`,
    `recipient: ${seat}`,
    'priority: 10',
    'type: note',
    `message: ${message}`,
    'created_at: 2026-08-17T00:00:00Z',
    'completed_at: 2026-08-17T00:05:00Z',
  ];
  if (noWorkReason) lines.push(`no_work_reason: ${noWorkReason}`, 'no_work_at: 2026-08-17T00:05:00Z');
  fs.writeFileSync(path.join(d, '10_20260817T000000Z_000001_note.handoff'), `${lines.join('\n')}\n\n${message}\n`);
}

function backdateQueuedParcel(ctx) {
  const queued = stageQueue(ctx);
  assert.equal(queued.length, 1, `exactly one parcel must be queued to back-date: ${queued}`);
  const file = path.join(seatDir(ctx.root, STAGE), '.swarmforge', 'handoffs', 'inbox', 'new', queued[0]);
  const aged = fs.readFileSync(file, 'utf8').replace(/^(enqueued_at|created_at): .*$/gm, `$1: ${AGED_INSTANT}`);
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

  scoped(/^the coder stage has two seats, coder and coder@2$/, (ctx) => {
    mkFixture(ctx, [STAGE, SEAT2]);
  });
  scoped(/^the coder stage has one seat, coder$/, (ctx) => {
    mkFixture(ctx, [STAGE]);
  });

  scoped(/^the coder seat's completed\/ holds a Work note naming ticket BL-0042 and no git_handoff for it$/, (ctx) => {
    seedCompletedWorkNote(ctx, STAGE, { ticket: TICKET });
  });
  scoped(/^the coder seat's completed\/ holds a note whose message names no ticket$/, (ctx) => {
    seedCompletedWorkNote(ctx, STAGE, {});
  });

  scoped(/^that note was completed (without a no-work reason|with a --no-work reason)$/, (ctx, shape) => {
    if (shape === 'with a --no-work reason') {
      const f = fs
        .readdirSync(path.join(seatDir(ctx.root, STAGE), '.swarmforge', 'handoffs', 'inbox', 'completed'))
        .find((n) => n.endsWith('.handoff'));
      const p = path.join(seatDir(ctx.root, STAGE), '.swarmforge', 'handoffs', 'inbox', 'completed', f);
      const content = fs.readFileSync(p, 'utf8').split('\n\n');
      const headers = content[0] + '\nno_work_reason: not ready\nno_work_at: 2026-08-17T00:05:00Z';
      fs.writeFileSync(p, `${headers}\n\n${content.slice(1).join('\n\n')}`);
    }
    // "without a no-work reason": the note as seeded already carries none.
  });

  scoped(/^the stage queue holds a git_handoff bounce for BL-0042 enqueued (moments ago|longer ago than the cross-seat claim deadline)$/, (ctx, age) => {
    try {
      send(ctx, TICKET);
      assert.equal(stageQueue(ctx).length, 1, `the bounce must reach the stage queue: ${stageQueue(ctx)}`);
      if (age === 'longer ago than the cross-seat claim deadline') {
        ctx.pastDeadline = true;
        backdateQueuedParcel(ctx);
      }
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^seat coder@2 asks for its next task$/, (ctx) => {
    ctx.asking = SEAT2;
    ctx.poll = poll(ctx, SEAT2);
  });
  scoped(/^seat coder asks for its next task$/, (ctx) => {
    ctx.asking = STAGE;
    ctx.poll = poll(ctx, STAGE);
  });

  scoped(
    /^the bounce (stays in the stage queue and the deferral line names coder|is claimed by coder@2|is claimed cross-seat and the claim says so|is claimed and no deferral line is printed)$/,
    (ctx, outcome) => {
      const out = `${ctx.poll.stdout || ''}\n${ctx.poll.stderr || ''}`;
      try {
        if (outcome === 'stays in the stage queue and the deferral line names coder') {
          assert.equal(stageQueue(ctx).length, 1, `the bounce must still sit in the stage queue:\n${out}`);
          assert.deepEqual(inProcess(ctx, ctx.asking), [], `the asking seat must claim nothing:\n${out}`);
          assert.match(out, /DEFERRED sibling-rework/, `the deferral must be said out loud:\n${out}`);
          // "names coder": the deferral leaves it precisely for the seat
          // that built it - coder, polling next, claims it.
          const coderPoll = poll(ctx, STAGE);
          const coderOut = `${coderPoll.stdout || ''}\n${coderPoll.stderr || ''}`;
          assert.equal(inProcess(ctx, STAGE).length, 1, `coder must claim the deferred bounce next:\n${coderOut}`);
        } else if (outcome === 'is claimed by coder@2') {
          assert.equal(inProcess(ctx, SEAT2).length, 1, `coder@2 must hold the claim:\n${out}`);
          assert.deepEqual(stageQueue(ctx), [], `the stage queue must be drained:\n${out}`);
        } else if (outcome === 'is claimed cross-seat and the claim says so') {
          assert.equal(inProcess(ctx, SEAT2).length, 1, `coder@2 must hold the claim:\n${out}`);
          assert.match(out, /CROSS_SEAT_CLAIM/, `the cross-seat claim must say so:\n${out}`);
        } else {
          assert.equal(inProcess(ctx, STAGE).length, 1, `coder must hold the claim:\n${out}`);
          assert.doesNotMatch(out, /DEFERRED sibling-rework/, `a single-seat stage must never defer:\n${out}`);
        }
      } finally {
        cleanup(ctx);
      }
    }
  );
}

module.exports = { registerSteps };
