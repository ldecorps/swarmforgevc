'use strict';

// BL-1901 declared invariants (coder first authorship - BL-654):
//   1. "origin/main only ever moves by fast-forward, and a merge-path land
//      publishes no commit naming a ticket other than the landing one."
//   2. "A line the merge path does not accept lands exactly as it does
//      today, through the land step, and is never half-landed."
//   3. "Every land leaves origin/main's register rows (standing-reds.tsv,
//      the property allowlist, suite-poles.tsv) as the land step's registry
//      pass would: none owned by the landing ticket, and every open other
//      ticket's row kept." (amendment 1c6f5d70a0, QA spec-gap note 003735)
//
// Each draw builds a fresh fixture (BL-1872's: bare origin, project repo, QA
// and line worktrees, under mkdtemp) plus the lander worktree, cuts a line of
// drawn commits from a drawn base, optionally moves origin/main, and runs the
// REAL land_merge_path.bb once. The bare origin keeps a reflog, so every
// update the land made to main is counted.
//   Invariant 1: every update of main is a fast-forward of the one before,
//   and when the merge path published, every commit it added names only the
//   landing ticket or is a merge.
//   Invariant 2: when the merge path declined, it moved main zero times
//   before handing over (the land step makes at most the one update it
//   always made), and the lander worktree is back on its own branch.
//   Invariant 3: whenever main moved, by either path, standing-reds.tsv on
//   main has no BL-9001 row and still has every open BL-9002 row origin/main
//   carried before the land. Collisions are constructed: origin/main is
//   drawn to carry the landing ticket's own row (the retire candidate) and
//   an open other ticket's row the line itself deletes (the restore
//   candidate). The other two registries share the same code path
//   (registry-pass-changes over land-step-lib/registry-specs) and are
//   pinned per registry in land_merge_path_lib_test_runner.bb.
//
// Generator reach is asserted: a real merge, a fast-forward and a decline
// each occur, and a land happens over an own row and over a deleted open
// row. REACH_EXAMPLES runs first and reaches all three by itself (the
// bl1871 lesson: ten random draws can miss a state). Other-ticket subjects
// are CONSTRUCTED from the landing id (a second id beside it, a digit
// appended, a merge naming its neighbour), so every one is a collision
// candidate. Merges are held to the ticket rule too (QA D2), and every
// merge-path land must carry the queued commit (QA D1).
//
// Non-vacuity: with line-verdict answering clean for every line, invariant 1
// fails on the first drawn other-ticket commit (the merge path publishes it).
// With registry-decline answering nil, invariant 3 fails on the first
// REACH_EXAMPLES row carrying an own row (the merge path publishes it).
// Both restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { fixture } = require('../../specs/pipeline/steps/bl1872LanderDaemonSteps');

const { makeFixture, git } = fixture;
const SCRIPT = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'land_merge_path.bb');
const TICKET = 'BL-9001';
const SUBJECTS = {
  own: `${TICKET}: own work`,
  other: 'BL-9002: unlanded work',
  both: `${TICKET} and BL-9002: shared fix`,
  prefix: `${TICKET}0: a different ticket`,
  untagged: 'tidy up',
};
// A merge of origin/main: a sync merge names no ticket; QA D2's merge names
// another ticket, constructed from the landing id's neighbour.
const MERGE_SUBJECTS = {
  'merge-origin': 'Merge main into coder.',
  'merge-other': 'Merge BL-9002 work into coder.',
};

const REGISTER = 'backlog/standing-reds.tsv';
const registerRow = (owner) => ['unit', `extension/test/${owner}.test.js`, owner, '2026-10-02', 'drawn'].join('\t');
const OWN_ROW = registerRow(TICKET);
const OPEN_ROW = registerRow('BL-9002');

function registerRows(fx, ref) {
  const r = spawnSync('git', ['-C', fx.origin, 'show', `${ref}:${REGISTER}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n').filter((l) => l && !l.startsWith('#')) : [];
}

function runDraw({ cutBehind, moveAfter, commits, register = {} }) {
  const fx = makeFixture();
  git(fx.origin, 'config', 'core.logAllRefUpdates', 'always');
  const wt = path.join(fx.root, '.worktrees', 'lander');
  git(fx.root, 'worktree', 'add', '-q', '-B', 'swarmforge-lander', wt, 'origin/main');
  const side = path.join(fx.work, 'side');
  git(fx.root, 'worktree', 'add', '-q', '--detach', side, 'origin/main');
  const moveOrigin = (n) => {
    git(side, 'fetch', '-q', 'origin');
    git(side, 'checkout', '-q', '--detach', 'origin/main');
    fs.writeFileSync(path.join(side, `origin-${n}.txt`), `${n}\n`);
    git(side, 'add', '-A');
    git(side, 'commit', '-q', '-m', `BL-9000: earlier land ${n}`);
    git(side, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  };
  // origin/main's register, and BL-9002 open by its paused YAML.
  if (register.ownRow || register.openRow) {
    const rows = [register.ownRow && OWN_ROW, register.openRow && OPEN_ROW].filter(Boolean);
    fs.mkdirSync(path.join(side, 'backlog', 'paused'), { recursive: true });
    fs.writeFileSync(path.join(side, REGISTER), `# lane\tfile\towner\tfirst_seen\tnote\n${rows.join('\n')}\n`);
    fs.writeFileSync(path.join(side, 'backlog', 'paused', 'BL-9002-open.yaml'), 'id: BL-9002\n');
    git(side, 'add', '-A');
    git(side, 'commit', '-q', '-m', 'BL-9000: register');
    git(side, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  }
  const base = git(fx.origin, 'rev-parse', 'main');
  if (cutBehind) moveOrigin('a');
  git(fx.line, 'fetch', '-q', 'origin');
  git(fx.line, 'checkout', '-q', '--detach', cutBehind ? base : 'origin/main');
  // The line deletes the open row in a commit of its own ticket.
  if (register.openRow && register.lineDropsOpen) {
    const file = path.join(fx.line, REGISTER);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== OPEN_ROW).join('\n'));
    git(fx.line, 'add', '-A');
    git(fx.line, 'commit', '-q', '-m', `${TICKET}: drop a row`);
  }
  commits.forEach((kind, i) => {
    if (MERGE_SUBJECTS[kind]) {
      git(fx.line, 'fetch', '-q', 'origin');
      git(fx.line, 'merge', '-q', '--no-ff', '-m', MERGE_SUBJECTS[kind], 'origin/main');
      return;
    }
    fs.writeFileSync(path.join(fx.line, `f${i}.txt`), `${kind}\n`);
    git(fx.line, 'add', '-A');
    git(fx.line, 'commit', '-q', '-m', SUBJECTS[kind]);
  });
  const queued = git(fx.line, 'rev-parse', 'HEAD');
  if (moveAfter) moveOrigin('b');
  const before = git(fx.origin, 'rev-parse', 'main');
  fx.rowsBefore = registerRows(fx, before);
  const reflogBefore = git(fx.origin, 'reflog', 'show', '--format=%H', 'main').split('\n').filter(Boolean).length;
  const res = spawnSync('bb', [SCRIPT, wt, TICKET, queued], { encoding: 'utf8', timeout: 120000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const updates = git(fx.origin, 'reflog', 'show', '--format=%H', 'main')
    .split('\n')
    .filter(Boolean)
    .slice(0, -reflogBefore || undefined)
    .reverse();
  return { fx, wt, out, before, queued, updates };
}

// Invariant 3, over whichever path moved main. Returns the register
// collisions this land resolved, for the reach floor.
function checkRegister({ fx, out, updates }) {
  if (updates.length === 0) return [];
  const after = registerRows(fx, 'main');
  assert.ok(!after.some((r) => r.split('\t')[2] === TICKET), `main kept ${TICKET}'s own row ${JSON.stringify(after)}:\n${out}`);
  const open = fx.rowsBefore.filter((r) => r === OPEN_ROW);
  for (const row of open) assert.ok(after.includes(row), `main dropped the open row ${row}:\n${out}`);
  return [fx.rowsBefore.includes(OWN_ROW) && 'retired', open.length > 0 && 'kept'].filter(Boolean);
}

function check(d) {
  const { fx, wt, out, before, queued, updates } = d;
  const path_ = /^LAND_PATH merge$/m.test(out) ? 'merge' : /^LAND_PATH land-step: /m.test(out) ? 'land-step' : null;
  assert.ok(path_, `no LAND_PATH line:\n${out}`);
  d.registerReach = checkRegister(d);
  // Invariant 1: each update fast-forwards the one before it.
  let prev = before;
  for (const sha of updates) {
    assert.equal(
      spawnSync('git', ['-C', fx.origin, 'merge-base', '--is-ancestor', prev, sha]).status,
      0,
      `main moved from ${prev} to ${sha} by a non-fast-forward:\n${out}`
    );
    prev = sha;
  }
  if (path_ === 'merge') {
    assert.equal(updates.length, 1, `the merge path moved main ${updates.length} times:\n${out}`);
    const added = git(fx.origin, 'log', '--format=%P%x09%s', `${before}..main`).split('\n').filter(Boolean);
    for (const line of added) {
      const [parents, subject] = line.split('\t');
      const ids = [...new Set((subject.match(/\b(?:BL|GH)-\d+\b/gi) || []).map((x) => x.toUpperCase()))];
      // A merge may name no ticket; no commit names one besides TICKET.
      const allowed = parents.split(' ').length > 1 && ids.length === 0 ? [] : [TICKET];
      assert.deepEqual(ids, allowed, `the merge path published "${subject}":\n${out}`);
    }
    // QA D1: a merge-path land always carries the queued commit.
    assert.equal(
      spawnSync('git', ['-C', fx.origin, 'merge-base', '--is-ancestor', queued, 'main']).status,
      0,
      `the merge path published ${git(fx.origin, 'rev-parse', 'main')} without the queued ${queued}:\n${out}`
    );
    return git(fx.origin, 'rev-parse', 'main') === queued ? 'ff' : 'merge';
  }
  // Invariant 2: nothing published before the hand-over; the land step makes
  // at most its one update; the lander worktree is home again.
  assert.ok(updates.length <= 1, `main moved ${updates.length} times on a declined line:\n${out}`);
  const handover = out.indexOf('LAND_PATH land-step');
  assert.doesNotMatch(out.slice(0, handover), /LAND_PUBLISHED/, out);
  assert.equal(git(wt, 'symbolic-ref', '--short', 'HEAD'), 'swarmforge-lander');
  return 'declined';
}

const kind = fc.oneof(
  { weight: 5, arbitrary: fc.constant('own') },
  { weight: 2, arbitrary: fc.constant('merge-origin') },
  { weight: 1, arbitrary: fc.constantFrom('other', 'both', 'prefix', 'untagged', 'merge-other') }
);
const draw = fc.record({
  cutBehind: fc.boolean(),
  moveAfter: fc.boolean(),
  commits: fc.array(kind, { minLength: 1, maxLength: 4 }),
  register: fc.record({ ownRow: fc.boolean(), openRow: fc.boolean(), lineDropsOpen: fc.boolean() }),
});

const REACH_EXAMPLES = [
  [{ cutBehind: true, moveAfter: true, commits: ['own', 'merge-origin', 'own'] }],
  [{ cutBehind: false, moveAfter: false, commits: ['own'] }],
  [{ cutBehind: false, moveAfter: false, commits: ['both', 'own'] }],
  // QA D2: the line is behind origin/main, so the merge naming BL-9002 is a
  // real merge commit on the line, and the line must decline.
  [{ cutBehind: true, moveAfter: false, commits: ['own', 'merge-other'] }],
  // Invariant 3's two collisions on clean lines the merge path would
  // otherwise publish as-is: the landing ticket's own row on origin/main,
  // and an open other ticket's row the line deletes.
  [{ cutBehind: false, moveAfter: false, commits: ['own'], register: { ownRow: true, openRow: false, lineDropsOpen: false } }],
  [{ cutBehind: true, moveAfter: true, commits: ['own'], register: { ownRow: false, openRow: true, lineDropsOpen: true } }],
];

test(
  'BL-1901/BL-654 invariants: origin/main moves only by fast-forward, the merge path publishes only its ticket, a declined line is never half-landed, a land leaves the register as the land step would',
  () => {
    const reach = { merge: 0, ff: 0, declined: 0, retired: 0, kept: 0 };
    fc.assert(
      fc.property(draw, (d) => {
        const run = runDraw(d);
        reach[check(run)] += 1;
        for (const r of run.registerReach) reach[r] += 1;
      }),
      { numRuns: 6, examples: REACH_EXAMPLES }
    );
    assert.ok(reach.merge >= 1, `merge reached: ${JSON.stringify(reach)}`);
    assert.ok(reach.ff >= 1, `fast-forward reached: ${JSON.stringify(reach)}`);
    assert.ok(reach.declined >= 1, `decline reached: ${JSON.stringify(reach)}`);
    assert.ok(reach.retired >= 1, `a land over the landing ticket's own row reached: ${JSON.stringify(reach)}`);
    assert.ok(reach.kept >= 1, `a land over a deleted open row reached: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS * 4
);
