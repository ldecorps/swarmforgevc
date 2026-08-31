'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1308 declared invariants:
//
// 1. Every ticket whose content the replay tip adds over origin/main is named
//    in the same run's sibling report.
// 2. The commit set the sibling detector walks includes every commit the
//    replay's own-path diff can draw content from.
//
// The defect these encode: the detector got its candidates from
// `rev-list --first-parent origin/main..<tip>`, while the replay's own-path
// set asks `own-commit-changed-paths` for `:delivered` - a merge's real diff
// against its FIRST parent, which returns everything the merge's SECOND
// parent brought in, whoever authored it. A sibling riding into a
// forward-merge on the second parent therefore entered the replay tip while
// its id never reached the report.
//
// Both properties drive REAL git repositories through the REAL bb code. The
// oracle is CONSTRUCTED by the generator - it records which ticket authored
// each path and which commits it created - never measured with a second git
// invocation that could share the implementation's blind spot.
//
// Generator reach is ASSERTED, not hoped for. The whole defect lives on the
// second parent of a merge, so a run that only ever drew linear trunk commits
// would pass against the broken implementation; `assertReach` below fails the
// property rather than reporting a vacuous green.
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const LAND_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');
const LAND_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');

const CITED = 'BL-9001';
const TASK = 'BL-9001-fixture';
const SIBLINGS = ['BL-9002', 'BL-9003'];
// `null` is a commit whose subject names no ticket at all - the bookkeeping
// shape the detector must never count as entanglement.
const TICKETS = [CITED, ...SIBLINGS, null];

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
}

function bb(args) {
  const res = execFileSync('bb', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
  return res;
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, 'add', '-A');
  git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', 'seed');
  const seed = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'update-ref', 'refs/remotes/origin/main', seed);
  return seed;
}

function subjectFor(ticket, what) {
  return ticket ? `${ticket}: ${what}.` : `${what} (unattributed bookkeeping).`;
}

/**
 * Builds the repository from `ops` and returns the CONSTRUCTED record of what
 * it built: every commit sha created after origin/main, and which ticket (if
 * any) authored each path.
 *
 * An op is either a trunk commit, or a merge whose SUBJECT names one ticket
 * while its side branch carries commits under their own, different subjects -
 * the forward-merge shape a role makes when it receives a handoff and passes
 * it on.
 */
function build(root, ops, seen) {
  const created = [];
  const authorOf = {};
  let n = 0;
  const commitOn = (ticket, what) => {
    const p = `f${n}.txt`;
    n += 1;
    fs.writeFileSync(path.join(root, p), `${p} by ${ticket || 'nobody'}\n`);
    git(root, 'add', '-A');
    git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', subjectFor(ticket, what));
    authorOf[p] = ticket;
    created.push(git(root, 'rev-parse', 'HEAD').trim());
    return p;
  };

  let branchN = 0;
  for (const op of ops) {
    if (op.kind === 'trunk') {
      seen.trunk += 1;
      commitOn(op.ticket, 'work on the trunk');
      continue;
    }
    seen.merge += 1;
    const branch = `bl1308-side-${branchN}`;
    branchN += 1;
    git(root, 'checkout', '-q', '-b', branch);
    for (const t of op.side) {
      if (t && t !== CITED) seen.siblingOnSide += 1;
      commitOn(t, 'work arriving through the merge');
    }
    git(root, 'checkout', '-q', 'main');
    // The merge subject names ONE ticket - the parcel being forwarded - and
    // says nothing about whose commits ride in on the second parent.
    git(
      root,
      '-c',
      'core.hooksPath=/dev/null',
      'merge',
      '--no-ff',
      '-q',
      '--no-verify',
      '-m',
      subjectFor(op.ticket, 'forward merge for the next role'),
      branch
    );
    created.push(git(root, 'rev-parse', 'HEAD').trim());
  }

  // The cited ticket must have at least one tagged commit on the first-parent
  // walk, or there is no parcel to replay and the run says nothing.
  commitOn(CITED, 'own work');
  return { created, authorOf };
}

/** The REAL CLI's report, parsed off the surface QA actually reads. */
function runCli(root, tip) {
  let out;
  let exit = 0;
  try {
    out = bb([LAND_CLI, TASK, tip, root]);
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
    exit = err.status;
  }
  const lines = out.trim().split('\n');
  const named = new Set();
  for (const line of lines) {
    const m = /^(?:ENTANGLED_SIBLING|LANDED_SIBLING) (\S+)$/.exec(line);
    if (m) named.add(m[1]);
    if (/entangled tip - sibling ticket\(s\)/.test(line)) {
      for (const id of line.match(/BL-\d+/g) || []) named.add(id);
    }
  }
  const head = lines[0].split(' ');
  return { out, exit, action: head[0], replayCommit: head[2] || '', named };
}

/** The detector's own candidate walk, asked directly. */
function ancestryCommits(root, base, tip) {
  const out = bb([
    '-e',
    `(load-file ${JSON.stringify(LAND_LIB)})
     (let [r (#'land-step-lib/ancestry-commits ${JSON.stringify(root)} ${JSON.stringify(base)} ${JSON.stringify(tip)})]
       (print (if (nil? r) "NIL" (clojure.string/join "\\n" r))))`,
  ]).trim();
  if (out === 'NIL') return null;
  return out.split('\n').filter(Boolean);
}

const OPS = () =>
  fc.array(
    fc.oneof(
      fc.record({ kind: fc.constant('trunk'), ticket: fc.constantFrom(...TICKETS) }),
      fc.record({
        kind: fc.constant('merge'),
        // The merge subject overwhelmingly names the CITED ticket: that is
        // the forward-merge shape, and the shape in which a sibling's commits
        // are invisible to a first-parent walk.
        ticket: fc.constantFrom(CITED, CITED, ...SIBLINGS),
        side: fc.array(fc.constantFrom(...TICKETS), { minLength: 1, maxLength: 2 }),
      })
    ),
    { minLength: 1, maxLength: 3 }
  );

// The shapes the defect hides behind, drawn outright so no random run can
// miss them: a sibling reachable ONLY through a merge's second parent.
const PINNED = [
  [{ kind: 'merge', ticket: CITED, side: [SIBLINGS[0]] }],
  [{ kind: 'merge', ticket: CITED, side: [SIBLINGS[0], null] }],
  [
    { kind: 'trunk', ticket: SIBLINGS[1] },
    { kind: 'merge', ticket: CITED, side: [SIBLINGS[0]] },
  ],
  [{ kind: 'trunk', ticket: null }],
];

function withRoot(fn) {
  const root = mkTmpDir('sfvc-bl1308-');
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The reach every run of either property must have: a merge, and a sibling
// on that merge's SECOND parent - the only place the defect lives. Invariant
// 1 additionally needs a run that actually reached the replay branch, which
// invariant 2 never builds, so that floor is asked for explicitly rather than
// stubbed out with a placeholder count.
function assertReach(seen, { needsReplay = false } = {}) {
  assert.ok(seen.merge > 0, `the generator never built a merge at all: ${JSON.stringify(seen)}`);
  assert.ok(
    seen.siblingOnSide > 0,
    `the generator never put a sibling on a merge's second parent - the only place the defect lives: ${JSON.stringify(seen)}`
  );
  if (needsReplay) {
    assert.ok(
      seen.replayed > 0,
      `no run ever reached the replay branch, so invariant 1 was never exercised: ${JSON.stringify(seen)}`
    );
  }
}

test('property (invariant 1): every ticket whose content the replay tip adds is named in the report', () => {
  const seen = { trunk: 0, merge: 0, siblingOnSide: 0, replayed: 0, clean: 0, escalated: 0 };
  const runCase = (ops) => {
    withRoot((root) => {
      const seed = initRepo(root);
      const { authorOf } = build(root, ops, seen);
      const tip = git(root, 'rev-parse', 'HEAD').trim();
      const report = runCli(root, tip);

      if (report.action === 'LAND_ESCALATE') {
        // Fail-closed is always an acceptable answer: nothing was landed, so
        // nothing entered origin/main unnamed.
        seen.escalated += 1;
        return;
      }
      if (report.action === 'LAND_CLEAN') {
        seen.clean += 1;
        // A clean land is the cited commit itself. It may only be blessed
        // when no OTHER ticket authored anything in the range at all.
        const foreignAuthors = new Set(
          Object.values(authorOf).filter((t) => t && t !== CITED)
        );
        assert.equal(
          foreignAuthors.size,
          0,
          `LAND_CLEAN while ${[...foreignAuthors].join(',')} authored content in the range: ${report.out}`
        );
        return;
      }

      assert.equal(report.action, 'LAND_REPLAY', `unexpected action: ${report.out}`);
      seen.replayed += 1;
      const added = git(root, 'diff', '--diff-filter=A', '--name-only', seed, report.replayCommit)
        .trim()
        .split('\n')
        .filter(Boolean);
      for (const p of added) {
        const author = authorOf[p];
        if (!author || author === CITED) continue;
        assert.ok(
          report.named.has(author),
          `the replay tip adds ${p}, authored under ${author}, which the report never named: ${report.out}`
        );
      }
    });
  };

  for (const ops of PINNED) runCase(ops);
  fc.assert(fc.property(OPS(), runCase), { numRuns: 12 });
  assertReach(seen, { needsReplay: true });
});

test('property (invariant 2): the detector walks every commit the replay can draw content from', () => {
  const seen = { trunk: 0, merge: 0, siblingOnSide: 0 };
  const runCase = (ops) => {
    withRoot((root) => {
      const seed = initRepo(root);
      const { created } = build(root, ops, seen);
      const tip = git(root, 'rev-parse', 'HEAD').trim();

      const walked = ancestryCommits(root, seed, tip);
      assert.notEqual(walked, null, 'the walk reported blindness on a readable range');
      const walkedSet = new Set(walked);
      // Every commit made after origin/main is one the replay's :delivered
      // diff can draw content from: a merge in this range is diffed against
      // its first parent, which returns its whole second-parent subtree.
      for (const sha of created) {
        assert.ok(
          walkedSet.has(sha),
          `the detector never walked ${sha.slice(0, 10)} (${git(root, 'log', '-1', '--format=%s', sha).trim()}), whose content the replay can draw from`
        );
      }
    });
  };

  for (const ops of PINNED) runCase(ops);
  fc.assert(fc.property(OPS(), runCase), { numRuns: 12 });
  assertReach(seen);
});
