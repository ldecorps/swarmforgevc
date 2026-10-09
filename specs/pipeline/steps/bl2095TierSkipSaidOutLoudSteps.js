'use strict';

// BL-2095: step handlers for "a seat that leaves a parcel above its tier
// says so". Follows bl1843NoteSeatRulesSteps.js's own fixture shape (a
// fixture roles.tsv with the two seats and their tiers, a fixture ticket
// per id, notes in the stage queue, the real dispatcher run as the asking
// seat) with one deliberate difference per the ticket's own notes: the
// easy seat here is the BARE `coder` row, whose mailbox IS the stage
// queue, as on the live full-forge pack - not a separate `coder@iq3` row.
//
// The fixture calls the LEAF (ready_for_next_task.bb) with cwd inside the
// fixture, never the real ready_for_next.sh dispatcher - the dispatcher
// cds to the real scripts tree and would claim LIVE mailboxes (BL-998).
//
// A fixture never touches the live repository or a live mailbox
// (engineering Guardrails, BL-1390; BL-1904's foreign-checkout guard).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
// BL-1002/BL-948 gate: this file references a control socket, so fixture
// roots come from the shared short-base helper, never os.tmpdir().
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-2095 A seat that leaves a parcel above its tier says so';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

const STAGE = 'coder';
const EASY = 'coder'; // == STAGE: the bare row IS the stage queue, as on the live pack
const HARD = 'coder@2';

// Explicit known values per the Scenario Outline handler rule: each
// substituted parameter is validated against the closed set the feature's
// Examples (and the literal scenarios) actually use - a row the handlers
// do not know is a hard failure, never a passthrough.
const KNOWN_TICKETS = new Set(['BL-9001', 'BL-9003']);
const KNOWN_COSTS = new Set(['medium', 'low']);
const KNOWN_WORKERS = new Set(['no seat', 'seat coder@2']);
const KNOWN_SEATS = new Set([EASY, HARD]);

function seatDir(root, role) {
  return path.join(root, role.replace('@', '-'));
}

function mkFixture(ctx) {
  const root = mkSocketFixtureRoot('bl2095-acc-');
  ctx.root = root;
  ctx.stage = STAGE;
  ctx.noteSeq = 0;
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q', '.']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  for (const r of [EASY, HARD]) {
    fs.mkdirSync(seatDir(root, r), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [EASY, HARD]
      .map((r) => `${r}\t${r.replace('@', '-')}-wt\t${seatDir(root, r)}\tswarmforge-${r}\t${r}\tclaude\ttask`)
      .join('\n') + '\n'
  );
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    [`window ${EASY} claude coder --seat-tier easy`, `window ${HARD} claude coder2 --seat-tier hard`, ''].join('\n')
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
  fs.writeFileSync(path.join(ctx.root, 'backlog', 'active', `${id}.yaml`), `id: ${id}\nmutation_cost: ${cost}\n`);
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
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.handoff')).sort() : [];
}

function queueFileNaming(ctx, ticket) {
  return stageQueue(ctx).find((f) => fs.readFileSync(path.join(seatDir(ctx.root, ctx.stage), '.swarmforge', 'handoffs', 'inbox', 'new', f), 'utf8').includes(ticket));
}

function inProcessFileNaming(ctx, role, ticket) {
  return inProcess(ctx, role).find((f) => fs.readFileSync(path.join(seatDir(ctx.root, role), '.swarmforge', 'handoffs', 'inbox', 'in_process', f), 'utf8').includes(ticket));
}

// The durable record BL-1004 reads: a git_handoff for the ticket in the
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
// state, not a send. A monotonic sequence number is folded into the
// filename (never relying on timestamp resolution alone) so two notes
// written back to back in the same test sort in WRITE order - load-bearing
// for "is at the head of the stage queue".
function writeNote(ctx, message) {
  const d = path.join(seatDir(ctx.root, ctx.stage), '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(d, { recursive: true });
  const now = new Date().toISOString();
  const seq = String(ctx.noteSeq++).padStart(3, '0');
  fs.writeFileSync(
    path.join(d, `50_${now.replace(/[:.]/g, '')}_${seq}_from_coordinator_to_${ctx.stage}_for_${ctx.stage}.handoff`),
    `id: ${now.replace(/[:.]/g, '')}_${seq}_from_coordinator\nfrom: coordinator\nto: ${ctx.stage}\nrecipient: ${ctx.stage}\npriority: 50\ntype: note\nmessage: ${message}\ncreated_at: ${now}\n\n${message}\n`
  );
}

function cleanup(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(new RegExp('^the coder stage has two seats, coder declared easy-only and coder@2 declared for hard work$'), (ctx) => {
    mkFixture(ctx);
  });

  // ── a-tier-skip-is-said-out-loud-01, also reused by scenario 02 ────────
  scoped(new RegExp("^ticket (BL-\\S+)'s mutation_cost is (\\S+)$"), (ctx, id, cost) => {
    try {
      assert.ok(KNOWN_TICKETS.has(id), `unknown ticket "${id}" - the handlers know ${[...KNOWN_TICKETS]}`);
      assert.ok(KNOWN_COSTS.has(cost), `unknown cost "${cost}" - the handlers know ${[...KNOWN_COSTS]}`);
      writeTicket(ctx, id, cost);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(new RegExp('^the stage queue holds the note "(.+)"$'), (ctx, message) => {
    try {
      writeNote(ctx, message);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(new RegExp('^seat (\\S+) asks for its next task$'), (ctx, asking) => {
    try {
      assert.ok(KNOWN_SEATS.has(asking), `unknown asking seat "${asking}" - the handlers know ${[...KNOWN_SEATS]}`);
      ctx.asking = asking;
      ctx.poll = poll(ctx, asking);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(new RegExp("^its output has a line naming that note's file, BL-9001 and medium as above this seat's tier$"), (ctx) => {
    const out = ctx.lastPollOut;
    try {
      const noteFile = queueFileNaming(ctx, 'BL-9001');
      assert.ok(noteFile, `expected BL-9001's note to still be findable in the stage queue:\n${out}`);
      assert.match(out, /TIER_SKIP:/, `expected a TIER_SKIP line:\n${out}`);
      const line = out.split('\n').find((l) => l.startsWith('TIER_SKIP:'));
      assert.ok(line, `expected a line starting TIER_SKIP::\n${out}`);
      assert.ok(line.includes(noteFile), `expected the TIER_SKIP line to name the note's file ${noteFile}: ${line}`);
      assert.ok(line.includes('BL-9001'), `expected the TIER_SKIP line to name BL-9001: ${line}`);
      assert.ok(line.includes('medium'), `expected the TIER_SKIP line to name the cost medium: ${line}`);
      assert.match(line, /above this seat's tier/, `expected the TIER_SKIP line to say "above this seat's tier": ${line}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(new RegExp('^that line names no other seat of the stage$'), (ctx) => {
    const out = ctx.lastPollOut;
    try {
      assert.ok(!out.includes(HARD), `no sibling seat id may appear in the claim output:\n${out}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(new RegExp('^its output ends with NO_TASK$'), (ctx) => {
    // stdout only - the task protocol's own output, never mixed with a
    // called helper's unrelated stderr diagnostics (e.g. backlog_depth_lib's
    // own "no swarm-identity" fallback notice).
    const stdout = ctx.poll.stdout;
    try {
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      assert.equal(lines[lines.length - 1], 'NO_TASK', `expected stdout to end with NO_TASK:\n${ctx.lastPollOut}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(new RegExp('^the note about (BL-\\S+) stays in the stage queue$'), (ctx, ticket) => {
    const out = ctx.lastPollOut;
    try {
      assert.ok(queueFileNaming(ctx, ticket), `expected the note about ${ticket} to still sit in the stage queue:\n${out}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
    cleanup(ctx);
  });

  // ── a-left-parcel-never-holds-up-the-one-behind-it-02 ───────────────────
  scoped(new RegExp('^BL-9001 has been worked by (.+?)$'), (ctx, worker) => {
    try {
      assert.ok(KNOWN_WORKERS.has(worker), `unknown worker "${worker}" - the handlers know ${[...KNOWN_WORKERS]}`);
      if (worker === 'seat coder@2') {
        seedPriorWork(ctx, HARD, 'BL-9001');
      }
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(new RegExp('^the note about BL-9001 is at the head of the stage queue$'), (ctx) => {
    const queued = stageQueue(ctx);
    try {
      assert.equal(queued.length, 2, `expected exactly two notes queued: ${queued}`);
      const headPath = path.join(seatDir(ctx.root, ctx.stage), '.swarmforge', 'handoffs', 'inbox', 'new', queued[0]);
      assert.ok(fs.readFileSync(headPath, 'utf8').includes('BL-9001'), `expected the head of the stage queue to be BL-9001's note, got: ${queued[0]}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });

  scoped(new RegExp('^seat coder claims the note about BL-9003$'), (ctx) => {
    // Not the last step of this scenario (BL-9001's own queue-stays
    // assertion follows) - cleanup happens there, not here.
    const out = ctx.lastPollOut;
    try {
      const claimed = inProcessFileNaming(ctx, EASY, 'BL-9003');
      assert.ok(claimed, `expected seat coder to hold a claim naming BL-9003 in in_process:\n${out}`);
      assert.match(out, /TASK:/, `the claim must be printed:\n${out}`);
    } catch (e) {
      cleanup(ctx);
      throw e;
    }
  });
}

module.exports = { registerSteps };
