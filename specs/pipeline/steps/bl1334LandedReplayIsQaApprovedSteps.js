'use strict';

// BL-1334: a land-step replay is QA-approved at the moment it lands.
//
// `is_qa_ancestor.sh` is the ONE definition of QA approval (BL-925 invariant
// 2). The land step's tip-pure replay mints a NEW commit and publishes it to
// main without advancing `swarmforge-QA`, so QA's own approved work read as
// unapproved until an unrelated later merge happened to close the window -
// and the coordinator had to `sync --override` to keep working. Human ruling:
// the land step RECORDS the replay->approved-source mapping and the predicate
// resolves it, rather than letting a script write the ref that DEFINES
// approval (which is the property BL-952 says must not erode).
//
// Every scenario EXECUTES the real predicate and the real gate over a real
// git fixture. A source-text assertion cannot tell a wired approval path from
// a dead one, and "the gate everyone assumed had fired" is this ticket's own
// fault class.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1334 a land-step replay is QA-approved at the moment it lands';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PREDICATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'is_qa_ancestor.sh');
const FRESHNESS_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'build_freshness_cli.bb');

// Scenario 02's Examples, validated against an explicit table rather than
// passed through - an Outline that accepts any placeholder asserts nothing
// about which case ran.
const KNOWN_COMMITS = {
  'the replay of an approved parcel': 'replayApproved',
  'a pipeline commit belonging to no approved parcel': 'unrelated',
  'the replay of a parcel carrying a bounce verdict': 'replayBounced',
};
const KNOWN_VERDICTS = { approved: 0, 'not approved': 1 };

function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
  }).trim();
}

function commit(root, file, subject) {
  const full = path.join(root, 'extension', 'src', file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${subject}\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', subject);
  return git(root, 'rev-parse', 'HEAD');
}

// A repository shaped exactly like the field occurrence: swarmforge-QA pinned
// at the approved source, replays landed on main after it, and NO merge into
// the QA ref afterwards.
function buildFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1334-'));
  ctx.cleanups = ctx.cleanups ?? [];
  ctx.cleanups.push(root);
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  // The REAL predicate, so this proves the shipped script's behaviour.
  fs.copyFileSync(PREDICATE, path.join(root, 'swarmforge', 'scripts', 'is_qa_ancestor.sh'));
  fs.chmodSync(path.join(root, 'swarmforge', 'scripts', 'is_qa_ancestor.sh'), 0o755);

  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');

  const approvedSource = commit(root, 'source.ts', 'BL-9001: the parcel QA approved');
  git(root, 'branch', 'swarmforge-QA');           // pinned here, never moved again
  // ORDER MATTERS: the approved replay comes FIRST after the QA ref, so
  // scenario 03 can rewind main to it and have the approved replay be the
  // ONLY drift. With an unapproved commit underneath it, the gate would
  // refuse for that commit instead and the scenario would prove nothing.
  const replayApproved = commit(root, 'replay-a.ts', 'BL-9001: tip-pure replay onto origin/main');
  const bouncedSource = commit(root, 'bounced.ts', 'BL-9002: a parcel QA sent back');
  const replayBounced = commit(root, 'replay-b.ts', 'BL-9002: tip-pure replay onto origin/main');
  const unrelated = commit(root, 'unrelated.ts', 'pipeline code belonging to no approved parcel');

  // The land step's records, in the shape land_step_lib.bb writes.
  const landDir = path.join(root, '.swarmforge', 'land-approvals');
  fs.mkdirSync(landDir, { recursive: true });
  fs.writeFileSync(
    path.join(landDir, '2026-09.jsonl'),
    `{"at":"2026-09-02T00:00:00Z","ticket":"BL-9001","commit":"${replayApproved.slice(0, 10)}","source":"${approvedSource.slice(0, 10)}"}\n` +
      `{"at":"2026-09-02T00:01:00Z","ticket":"BL-9002","commit":"${replayBounced.slice(0, 10)}","source":"${bouncedSource.slice(0, 10)}"}\n`
  );
  // QA's bounce verdict on the second parcel's source.
  const bounceDir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(bounceDir, { recursive: true });
  fs.writeFileSync(
    path.join(bounceDir, '2026-09.jsonl'),
    `{"at":"2026-09-02T00:02:00Z","by":"QA","commit":"${bouncedSource.slice(0, 10)}","evidence":"x"}\n`
  );

  return { root, approvedSource, bouncedSource, replayApproved, replayBounced, unrelated };
}

function askPredicate(fixture, sha) {
  try {
    execFileSync('bash', [path.join(fixture.root, 'swarmforge', 'scripts', 'is_qa_ancestor.sh'), sha], {
      cwd: fixture.root,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return 0;
  } catch (err) {
    return err.status;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────

  scoped(/^a repository whose land step publishes tip-pure replays onto the main branch$/, (ctx) => {
    ctx.bl1334 = buildFixture(ctx);
  });

  // ── Given ───────────────────────────────────────────────────────────────

  scoped(/^the land step has replayed an approved parcel onto the main branch$/, (ctx) => {
    const f = ctx.bl1334;
    f.subject = f.replayApproved;
    // main is rewound to the replay, so it is the ONLY drift since the QA
    // ref. Otherwise the deploy gate would refuse for one of the later
    // deliberately-unapproved commits and scenario 03 would pass or fail for
    // a reason that has nothing to do with the land record.
    git(f.root, 'checkout', '-q', '-B', 'main', f.replayApproved);
    assert.match(git(f.root, 'branch', '--contains', f.subject), /\bmain\b/);
    // And it really does touch the deployed surface, or the gate would let it
    // through as bookkeeping regardless of approval.
    assert.match(git(f.root, 'show', '--stat', '--format=', f.subject), /extension\/src\//);
  });

  scoped(/^no merge into the QA ref has happened since that land$/, (ctx) => {
    // The heart of the defect, asserted rather than assumed: the QA ref still
    // points at the approved SOURCE, and the replay is not reachable from it.
    assert.equal(git(ctx.bl1334.root, 'rev-parse', 'swarmforge-QA'), ctx.bl1334.approvedSource);
    let ancestor = true;
    try {
      git(ctx.bl1334.root, 'merge-base', '--is-ancestor', ctx.bl1334.subject, 'swarmforge-QA');
    } catch {
      ancestor = false;
    }
    assert.equal(ancestor, false, 'the fixture must be one where ancestry alone would refuse');
  });

  scoped(/^(.+) is on the main branch$/, (ctx, which) => {
    const key = KNOWN_COMMITS[which];
    assert.ok(key, `unknown commit description "${which}"`);
    ctx.bl1334.subject = ctx.bl1334[key];
    assert.match(git(ctx.bl1334.root, 'branch', '--contains', ctx.bl1334.subject), /\bmain\b/);
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the shared QA-approval predicate is asked about the landed commit$/, (ctx) => {
    ctx.bl1334.exit = askPredicate(ctx.bl1334, ctx.bl1334.subject);
  });

  scoped(/^the shared QA-approval predicate is asked about it$/, (ctx) => {
    ctx.bl1334.exit = askPredicate(ctx.bl1334, ctx.bl1334.subject);
  });

  scoped(/^the build freshness gate reports on the main branch$/, (ctx) => {
    const out = execFileSync('bb', [FRESHNESS_CLI, ctx.bl1334.root, 'report'], {
      cwd: ctx.bl1334.root,
      encoding: 'utf8',
    });
    ctx.bl1334.report = JSON.parse(out.trim().split('\n').pop());
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^it answers approved$/, (ctx) => {
    assert.equal(ctx.bl1334.exit, 0, 'the predicate must answer approved with no merge into the QA ref');
  });

  scoped(/^it answers (approved|not approved)$/, (ctx, verdict) => {
    const want = KNOWN_VERDICTS[verdict];
    assert.notEqual(want, undefined, `unknown verdict "${verdict}"`);
    assert.equal(ctx.bl1334.exit, want);
  });

  scoped(/^it reports the branch as QA-approved$/, (ctx) => {
    assert.equal(ctx.bl1334.report.qa_approval.approved, true);
    assert.equal(ctx.bl1334.report.qa_approval.could_not_determine, false);
  });

  scoped(/^it names no offending commit$/, (ctx) => {
    assert.deepEqual(ctx.bl1334.report.qa_approval.offending_shas, []);
  });
}

module.exports = { registerSteps };
