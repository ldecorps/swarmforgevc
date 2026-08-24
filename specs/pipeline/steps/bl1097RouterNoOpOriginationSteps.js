'use strict';

// BL-1097: step handlers for "The router never originates a parcel for work
// already finished".
//
// Every scenario drives the REAL route_backlog_to_coder.sh against a fixture
// project root - real promotion_gates_cli.bb, real swarm_handoff.sh, real
// dispatch_trail_cli.bb. A JS restatement of the gate would prove only that
// the restatement agrees with itself; the defect was that the shipped script
// had no such check at all, so the script is what has to be asked.
//
// What "a parcel is emitted" means here is deliberately physical: a .handoff
// file appearing anywhere under the fixture's mailbox tree. It is counted
// before and after, so the assertion is about what the router DID, not about
// its exit code - a refusal that still wrote a parcel would pass an exit-code
// check and fail this one.
//
// No tmux: SWARMFORGE_SKIP_SYNC_INJECT=1 keeps the outbound path off the live
// swarm. A shell test that touched tmux killed eight live swarm sessions on
// 2026-08-22, and these handlers run on every parcel.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const ROUTE_SH = path.join(SCRIPTS_DIR, 'route_backlog_to_coder.sh');
const TRAIL_CLI = path.join(SCRIPTS_DIR, 'dispatch_trail_cli.bb');

const FEATURE = 'The router never originates a parcel for work already finished';
const FIXTURE_PREFIX = 'bl1097-router-';

// BL-421: every Examples column value resolves through an explicit lookup, so
// a gherkin-mutator edit into an unrecognised value fails the scenario rather
// than slipping through an else branch as if it were the case not named.
const KNOWN_TRAILS = {
  'has never been dispatched': { seedTrail: false },
  'already has a dispatch trail': { seedTrail: true },
};
const KNOWN_OUTCOMES = {
  emitted: { expectParcel: true },
  'not emitted': { expectParcel: false },
};

function lookup(table, key, column) {
  const hit = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  assert.ok(hit, `unrecognised ${column} value: ${JSON.stringify(key)} (known: ${Object.keys(table).join(', ')})`);
  return hit;
}

function sweepStale() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

// A project root the real scripts can work in: a git repo (target-root
// resolution walks git), a roles.tsv (mailbox paths come from it), a conf (the
// depth gate reads it), and the three backlog folders.
function makeRoot(ctx) {
  sweepStale();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  for (const folder of ['active', 'paused', 'done']) {
    fs.mkdirSync(path.join(root, 'backlog', folder), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    [
      ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'].join('\t'),
      ['coder', 'coder', root, 'swarmforge-coder', 'Coder', 'claude', 'task'].join('\t'),
      ['cleaner', 'cleaner', root, 'swarmforge-cleaner', 'Cleaner', 'claude', 'batch'].join('\t'),
    ].join('\n') + '\n'
  );
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), 'config active_backlog_max_depth 50\n');
  ctx.root = root;
  return root;
}

function writeActive(root, id, extra = '') {
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${id}-fixture.yaml`),
    `id: ${id}\ntitle: "fixture"\nstatus: todo\nassigned_to: coder\n${extra}`
  );
}

function parcelCount(root) {
  const base = path.join(root, '.swarmforge', 'handoffs');
  let n = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.handoff')) n += 1;
    }
  };
  walk(base);
  return n;
}

function route(root, args) {
  return spawnSync('bash', [ROUTE_SH, ...args, root], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SWARMFORGE_CONFIG: undefined,
      SWARMFORGE_SKIP_SYNC_INJECT: '1',
      SWARMFORGE_ROLE: 'coordinator',
    },
  });
}

// Seeds the trail the same way the swarm does: by actually routing once. A
// hand-written .handoff file would be a guess at the shape the predicate
// reads; routing produces the real thing, and it is also literally the
// situation the ticket describes - the router's own earlier Work note is what
// makes the second route a no-op.
function seedTrailByRouting(root, id) {
  const result = route(root, [id]);
  assert.ok(
    parcelCount(root) > 0,
    `seeding the trail required a first route to emit a parcel; it did not.\n${result.stdout}${result.stderr}`
  );
}

function trailAnswer(root, id) {
  return execFileSync('bb', [TRAIL_CLI, root, 'dispatched', id], { cwd: root, encoding: 'utf8' }).trim();
}

function sweepUndispatched(root) {
  return execFileSync('bb', [TRAIL_CLI, root, 'undispatched-active'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── 01 ───────────────────────────────────────────────────────────────────
  scoped(/^an active ticket assigned to a role$/, (ctx) => {
    const root = makeRoot(ctx);
    ctx.ticketId = 'BL-9097';
    writeActive(root, ctx.ticketId);
  });

  // The Examples column is captured broadly and validated against
  // KNOWN_TRAILS, so a gherkin-mutator edit fails loudly instead of slipping
  // through. The lookahead is what keeps that breadth from also swallowing
  // scenario 02's "the ticket has not yet been moved to backlog/done/" - the
  // registry is first-match-in-registration-order, and a step stolen by
  // registration order is a bug waiting for the next reorder, not a fact.
  scoped(/^the ticket (?!has not yet been moved to backlog\/done\/$)(.+)$/, (ctx, trail) => {
    const { seedTrail } = lookup(KNOWN_TRAILS, trail, 'trail');
    if (seedTrail) {
      seedTrailByRouting(ctx.root, ctx.ticketId);
      assert.equal(
        trailAnswer(ctx.root, ctx.ticketId),
        'DISPATCHED',
        'the Given did not actually establish a trail - the scenario would assert nothing'
      );
    } else {
      assert.equal(
        trailAnswer(ctx.root, ctx.ticketId),
        'UNDISPATCHED',
        'the Given claims no trail but the fixture already has one'
      );
    }
  });

  // Shared by 01 and 02.
  scoped(/^the coordinator routes the backlog$/, (ctx) => {
    ctx.parcelsBefore = parcelCount(ctx.root);
    ctx.result = route(ctx.root, [ctx.ticketId]);
    ctx.parcelsAfter = parcelCount(ctx.root);
  });

  scoped(/^a parcel is (.+) for that ticket$/, (ctx, outcome) => {
    const { expectParcel } = lookup(KNOWN_OUTCOMES, outcome, 'outcome');
    const emitted = ctx.parcelsAfter - ctx.parcelsBefore;
    const detail = `\nrc=${ctx.result.status}\nstdout: ${ctx.result.stdout}\nstderr: ${ctx.result.stderr}`;
    if (expectParcel) {
      assert.ok(emitted > 0, `expected a parcel to be emitted, none was.${detail}`);
    } else {
      assert.equal(emitted, 0, `expected no parcel, ${emitted} emitted.${detail}`);
      assert.equal(ctx.result.status, 3, `a refusal must exit 3, not read as a successful route.${detail}`);
      assert.match(
        ctx.result.stderr,
        /already has a dispatch trail/,
        `the refusal must say why, naming the ticket.${detail}`
      );
    }
  });

  // ── 02 ───────────────────────────────────────────────────────────────────
  // The window the defect lives in: work finished, ticket still active. The
  // trail is what "finished" is legible as from outside - nothing writes
  // status:, which is the whole reason the router could not tell.
  scoped(/^an active ticket whose work is complete and QA-approved$/, (ctx) => {
    const root = makeRoot(ctx);
    ctx.ticketId = 'BL-9098';
    writeActive(root, ctx.ticketId);
    seedTrailByRouting(root, ctx.ticketId);
    // ... and the work travelled on and came back approved: a git_handoff
    // through the pipeline, sitting completed in the cleaner's mailbox.
    const completed = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'completed');
    fs.mkdirSync(completed, { recursive: true });
    fs.writeFileSync(
      path.join(completed, '50_qa_approved.handoff'),
      ['from: coder', 'to: cleaner', 'type: git_handoff', `task: ${ctx.ticketId}-fixture`, 'commit: 0fb5c4442f'].join(
        '\n'
      ) + '\n\nbody\n'
    );
  });

  scoped(/^the ticket has not yet been moved to backlog\/done\/$/, (ctx) => {
    const active = fs.readdirSync(path.join(ctx.root, 'backlog', 'active'));
    const done = fs.readdirSync(path.join(ctx.root, 'backlog', 'done'));
    assert.ok(
      active.some((f) => f.startsWith(ctx.ticketId)),
      'the ticket must still be in backlog/active/ - that is the state being tested'
    );
    assert.ok(
      !done.some((f) => f.startsWith(ctx.ticketId)),
      'a fix that only checked backlog/done/ membership must still fail this scenario'
    );
  });

  scoped(/^no parcel is emitted for that ticket$/, (ctx) => {
    const emitted = ctx.parcelsAfter - ctx.parcelsBefore;
    const detail = `\nrc=${ctx.result.status}\nstdout: ${ctx.result.stdout}\nstderr: ${ctx.result.stderr}`;
    assert.equal(emitted, 0, `expected no parcel for finished-but-unclosed work, ${emitted} emitted.${detail}`);
    assert.equal(ctx.result.status, 3, `a refusal must exit 3.${detail}`);
  });

  // ── 03 ───────────────────────────────────────────────────────────────────
  scoped(/^a set of active tickets in mixed dispatch states$/, (ctx) => {
    const root = makeRoot(ctx);
    ctx.corpus = ['BL-9101', 'BL-9102', 'BL-9103', 'BL-9104'];
    for (const id of ctx.corpus) writeActive(root, id);
    // Mixed on purpose, and mixed across mailbox STATES as well as across
    // tickets: a trail in inbox/new, one that has moved to completed, one
    // nested in a batch_* subdirectory, and one ticket with nothing at all.
    seedTrailByRouting(root, 'BL-9101');
    const handoffs = path.join(root, '.swarmforge', 'handoffs');
    const write = (dir, name, headers) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), headers.join('\n') + '\n\nbody\n');
    };
    write(path.join(handoffs, 'inbox', 'completed'), '50_a.handoff', [
      'from: coder',
      'to: cleaner',
      'type: git_handoff',
      'task: BL-9102-fixture',
    ]);
    write(path.join(handoffs, 'inbox', 'in_process', 'batch_20260823T000000Z_01'), '50_b.handoff', [
      'from: coder',
      'to: cleaner',
      'type: git_handoff',
      'task: BL-9103-fixture',
    ]);
    ctx.expectedUndispatched = ['BL-9104'];
  });

  scoped(/^the router and the dispatch-gap sweep are each asked which are undispatched$/, (ctx) => {
    ctx.sweepSays = sweepUndispatched(ctx.root);
    ctx.routerSays = ctx.corpus.filter((id) => trailAnswer(ctx.root, id) === 'UNDISPATCHED').sort();
  });

  scoped(/^the two answers are identical$/, (ctx) => {
    assert.deepEqual(
      ctx.routerSays,
      ctx.sweepSays,
      `router said [${ctx.routerSays.join(', ')}] but the sweep said [${ctx.sweepSays.join(', ')}]`
    );
    // Agreeing on nothing is agreement, and it would prove nothing. The corpus
    // is mixed by construction and the expected partition is stated, so this
    // scenario cannot pass by both sides going blind at once.
    assert.deepEqual(
      ctx.sweepSays,
      ctx.expectedUndispatched,
      `the agreement is vacuous: expected exactly [${ctx.expectedUndispatched.join(', ')}] undispatched`
    );
  });
}

module.exports = { registerSteps };
