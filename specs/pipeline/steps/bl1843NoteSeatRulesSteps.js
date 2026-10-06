'use strict';

// BL-1843: step handlers for "a note about a ticket is claimed under the
// same seat rules as the ticket's own parcels". Every scenario drives the
// REAL machinery over a fixture root: a note naming a ticket sits in the
// stage queue, a seeded completed/ parcel is the durable record of the
// ticket's prior worker, and the reworked ready_for_next_task.bb decides
// at the claim — tier filter (BL-1001) and sibling-rework deferral
// (BL-1004) both apply to the note exactly as they would to a git_handoff
// for that ticket.
//
// The fixture calls the LEAF (ready_for_next_task.bb) with cwd inside the
// fixture, never the real ready_for_next.sh dispatcher - the dispatcher
// cds to the real scripts tree and would claim LIVE mailboxes (BL-998).
//
// "That note has waited past the cross-seat claim deadline" advances the
// pinned fixture clock by BACK-DATING the note's own enqueued_at/
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

const FEATURE = 'BL-1843 A note about a ticket is claimed under the same seat rules as the ticket\'s own parcels';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const STAGE = 'coder';
const HARD = 'coder';
const EASY = 'coder@iq3';
const AGED_INSTANT = '2020-01-01T00:00:00Z';

// Explicit known values per the Scenario Outline handler rule: each
// substituted parameter is validated against the closed set the feature's
// Examples (and the literal scenarios) actually use - a row the handlers
// do not know is a hard failure, never a passthrough.
const KNOWN_TICKETS = new Set(['BL-9001', 'BL-9002']);
const KNOWN_COSTS = new Set(['medium', 'low']);
const KNOWN_SEATS = new Set(['coder', 'coder@iq3']);

function seatDir(root, role) {
  return path.join(root, role.replace('@', '-'));
}

function mkFixture(ctx) {
  const root = mkSocketFixtureRoot('bl1843-acc-');
  ctx.root = root;
  ctx.stage = STAGE;
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  const roles = [HARD, EASY];
  for (const r of roles) {
    fs.mkdirSync(seatDir(root, r), { recursive: true });
  }
  // The stage-named row (BL-983) is the stage's addressable queue: its
  // mailbox is the shared queue seats claim from, and its window line
  // declares the stage tier so a tier-active stage never reads as
  // undeclared (BL-1001).
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      `${STAGE}\t${STAGE}-wt\t${seatDir(root, STAGE)}\tswarmforge-${STAGE}\t${STAGE}\tclaude\ttask`,
      ...roles.map((r) => `${r}\t${r.replace('@', '-')}-wt\t${seatDir(root, r)}\tswarmforge-${r}\t${r}\tclaude\ttask`),
    ].join('\n') + '\n'
  );
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    [
      `window ${STAGE} claude ${STAGE}`,
      `window ${HARD} claude coder --seat-tier hard`,
      `window ${EASY} claude coder-iq3 --seat-tier easy`,
      '',
    ].join('\n')
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

function writeTicket(ctx, id, cost) {
  ctx.ticketId = id;
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${id}.yaml`),
    `id: ${id}\nmutation_cost: ${cost}\n`
  );
}

function poll(ctx, role) {
  // The fixture repo has no origin, so the take-up's `git fetch origin`
  // fails and the worktree move is refused - the claim itself (the file
  // move into in_process/) is what these scenarios assert, and a refused
  // take-up still leaves the claim in place.
  const r = spawnSync('bb', [path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')], {
    cwd: seatDir(ctx.root, role),
    encoding: 'utf8',
    timeout: 60000,
    env: fixtureEnv(ctx.root, role),
  });
  ctx.lastPollOut = `${r.stdout}\n${r.stderr}`;
  return r;
}

function inProcess(ctx, role) {
  const d = path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : [];
}

function stageQueue(ctx) {
  const d = path.join(seatDir(ctx.root, ctx.stage), '.swarmforge', 'handoffs', 'inbox', 'new');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')) : [];
}

// The durable record BL-1843 reads: a git_handoff for the ticket in the
// sibling seat's completed/. Seeded directly - fixture state, not a send.
function seedPriorWork(ctx, seat, task) {
  const d = path.join(seatDir(ctx.root, seat), '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, `50_20260820T000000Z_000001_from_${seat.replace('@', '-')}_to_${seat.replace('@', '-')}_for_${seat.replace('@', '-')}.handoff`),
    `id: 20260820T000000Z_000001_from_${seat.replace('@', '-')}\nfrom: ${seat}\nto: ${ctx.stage}\nrecipient: ${ctx.stage}\npriority: 50\ntype: git_handoff\ntask: ${task}\ncommit: ${ctx.commit}\ncreated_at: 2026-08-20T00:00:00Z\n\nmerge_and_process ${seat} ${ctx.commit}\n`
  );
}

// The note under test: written directly into the stage queue - fixture
// state, not a send. The body is the message itself (a headers-only file
// is quarantined as corrupt by handoff_lib's structural check).
function writeNote(ctx, message) {
  const d = path.join(seatDir(ctx.root, ctx.stage), '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(d, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(d, `50_${now.replace(/[:.]/g, '')}_from_coordinator_to_${ctx.stage}_for_${ctx.stage}_for_${ctx.stage}.handoff`),
    `id: ${now.replace(/[:.]/g, '')}_from_coordinator\nfrom: coordinator\nto: ${ctx.stage}\nrecipient: ${ctx.stage}\npriority: 50\ntype: note\nmessage: ${message}\ncreated_at: ${now}\n\n${message}\n`
  );
}

function backdateQueuedNote(ctx) {
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

  scoped(/^a swarm where a note addresses a stage and a seat claims from that stage's queue$/, () => {
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIR, 'ready_for_next_task.bb')), 'claim path script must exist');
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIR, 'seat_affinity_lib.bb')), 'seat affinity lib must exist');
  });

  scoped(/^the coder stage has two seats, coder declared for hard work and coder@iq3 declared easy-only$/, (ctx) => {
    mkFixture(ctx);
  });

  scoped(/^ticket (BL-\S+)'s mutation_cost is (\S+)$/, (ctx, id, cost) => {
    try {
      assert.ok(KNOWN_TICKETS.has(id), `unknown ticket "${id}" - the handlers know ${[...KNOWN_TICKETS]}`);
      assert.ok(KNOWN_COSTS.has(cost), `unknown cost "${cost}" - the handlers know ${[...KNOWN_COSTS]}`);
      writeTicket(ctx, id, cost);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^seat (\S+) has worked (BL-\S+)$/, (ctx, seat, task) => {
    try {
      assert.ok(KNOWN_SEATS.has(seat), `unknown seat "${seat}" - the handlers know ${[...KNOWN_SEATS]}`);
      assert.ok(KNOWN_TICKETS.has(task), `unknown ticket "${task}" - the handlers know ${[...KNOWN_TICKETS]}`);
      seedPriorWork(ctx, seat, task);
      ctx.workedBy = seat;
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the stage queue holds the note "(.+)"$/, (ctx, message) => {
    try {
      writeNote(ctx, message);
      assert.equal(stageQueue(ctx).length, 1, `the note must reach the stage queue: ${stageQueue(ctx)}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^that note has waited past the cross-seat claim deadline$/, (ctx) => {
    try {
      ctx.pastDeadline = true;
      backdateQueuedNote(ctx);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^seat (\S+) asks for its next task$/, (ctx, asking) => {
    try {
      assert.ok(KNOWN_SEATS.has(asking), `unknown asking seat "${asking}" - the handlers know ${[...KNOWN_SEATS]}`);
      ctx.asking = asking;
      ctx.poll = poll(ctx, asking);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(/^the note (stays in the stage queue|is claimed by that seat)$/, (ctx, outcome) => {
    const out = ctx.lastPollOut || `${ctx.poll.stdout}\n${ctx.poll.stderr}`;
    const finish = () => {
      if (!ctx.pastDeadline) cleanup(ctx);
    };
    try {
      if (outcome === 'stays in the stage queue') {
        assert.equal(stageQueue(ctx).length, 1, `the note must still sit in the stage queue:\n${out}`);
        assert.deepEqual(inProcess(ctx, ctx.asking), [], `the asking seat must claim nothing:\n${out}`);
        // The property's out-loud half: a declined claim says so.
        // An affinity deferral says so out loud; a tier refusal prints only
        // NO_TASK (BL-1001), so the line is asserted only when a sibling
        // seat worked the ticket.
        if (ctx.workedBy && ctx.workedBy !== ctx.asking) {
          assert.match(out, /DEFERRED sibling-rework/, `the deferral must be said out loud:\n${out}`);
        }
        // Invariant 2 at the wiring level: the diagnostic names no seat.
        assert.ok(!out.includes('coder@iq3'), `no seat id may appear in the claim output:\n${out}`);
      } else {
        assert.equal(inProcess(ctx, ctx.asking).length, 1, `the asking seat must hold the claim:\n${out}`);
        assert.deepEqual(stageQueue(ctx), [], `the stage queue must be drained:\n${out}`);
        // The claim must be said out loud too: a claimed parcel is printed,
        // never silently moved.
        assert.match(out, /TASK:/, `the claim must be printed:\n${out}`);
        assert.ok(!out.includes('PARCEL_LINE:'), 'the take-up must not be refused:\n' + out);
      }
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
    finish();
  });
}

module.exports = { registerSteps };
