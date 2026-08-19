const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { bounceRevertCheck } = require('../out/quality/bounceRevertCheck');
const { main, revertCheckSeam } = require('../out/tools/record-bounce');
const { readBounceRecords } = require('../out/metrics/bounceStore');

// BL-954 declared invariants (backlog/active/BL-954-a-bounce-verifies-its-own-revert.yaml):
// 1. The verdict is decided by whether the bounced commit's CONTENT is
//    present at the bouncing branch tip, never by whether the commit is
//    reachable from it.
// 2. The already-on-main exception never produces a revert instruction.
// 3. Recording the bounce is never contingent on the check; a check that
//    cannot complete reports its cause rather than reading as clean.
// Coder-authored property tests per BL-654; runs only via npm run test:properties.
//
// Non-vacuity proven by hand at authoring time: making gatherBounceRevertFacts
// consult `merge-base --is-ancestor <commit> <branch>` and mark every file
// live when it holds fails invariant 1's ancestry-flip property on its first
// pair; blanking the breach-report early return fails invariant 2
// immediately; making record-bounce run the check BEFORE
// appendBounceRecordIfNew and rethrow fails invariant 3's throwing shape.
// All restored.

// ── A fake GitReader simulating one repo state in memory ───────────────────
// The state carries `ancestorOfBranch` even though a content-based check
// must never ask for it - the fake answers it anyway, so a regression that
// starts consulting branch ancestry changes verdicts and fails the flip
// property below BY CONSTRUCTION rather than by luck.

const COMMIT = 'abcdef1234';
const BRANCH = 'swarmforge-architect';

function fakeGit(state) {
  return (args) => {
    const joined = args.join(' ');
    if (joined === `rev-parse --verify --quiet ${COMMIT}^{commit}`) {
      return { status: state.commitOk ? 0 : 1, stdout: '' };
    }
    if (joined === `rev-parse --verify --quiet ${BRANCH}^{commit}`) {
      return { status: state.branchOk ? 0 : 1, stdout: '' };
    }
    if (joined === `merge-base --is-ancestor ${COMMIT} main`) {
      return { status: state.ancestorOfMain ? 0 : 1, stdout: '' };
    }
    if (joined === `merge-base --is-ancestor ${COMMIT} ${BRANCH}`) {
      return { status: state.ancestorOfBranch ? 0 : 1, stdout: '' };
    }
    if (joined === `diff-tree --no-commit-id --name-only -r ${COMMIT}`) {
      return { status: 0, stdout: state.files.map((f) => f.path).join('\n') + (state.files.length ? '\n' : '') };
    }
    const show = args[0] === 'show' && args[1];
    if (show) {
      const [rev, ...rest] = args[1].split(':');
      const file = state.files.find((f) => f.path === rest.join(':'));
      const content = file ? { [COMMIT]: file.bounced, [`${COMMIT}^`]: file.parent, [BRANCH]: file.tip }[rev] : undefined;
      return content === undefined || content === null ? { status: 128, stdout: '' } : { status: 0, stdout: content };
    }
    throw new Error(`fake git has no answer for: ${joined}`);
  };
}

// Each generated file is one of three shapes, BY CONSTRUCTION:
//   live      - tip holds the bounced version and the commit really changed it
//   reverted  - tip back at the parent version
//   untouched - the commit never changed this path (bounced == parent)
const fileArb = fc
  .record({
    path: fc.constantFrom('src/a.ts', 'src/b.ts', 'docs/c.md', 'test/d.js'),
    shape: fc.constantFrom('live', 'reverted', 'untouched'),
    seq: fc.nat({ max: 999 }),
  })
  .map(({ path: p, shape, seq }) => {
    const parent = `parent-${seq}\n`;
    const bounced = shape === 'untouched' ? parent : `bounced-${seq}\n`;
    const tip = shape === 'reverted' ? parent : bounced;
    return { path: p, parent, bounced, tip, shape };
  });

const uniqueFilesArb = fc
  .uniqueArray(fileArb, { minLength: 1, maxLength: 4, selector: (f) => f.path });

function check(state) {
  return bounceRevertCheck({ repoRoot: '/nowhere', commit: COMMIT, by: 'architect', runGit: fakeGit(state) });
}

// ── Invariant 1: content decides; branch ancestry flips change nothing ─────

test('BL-954 invariant 1: for any content state, the verdict is identical whether or not the commit is an ancestor of the bouncing branch', () => {
  let liveSeen = 0;
  let revertedSeen = 0;
  fc.assert(
    fc.property(uniqueFilesArb, (files) => {
      const base = { commitOk: true, branchOk: true, ancestorOfMain: false, files };
      const asAncestor = check({ ...base, ancestorOfBranch: true });
      const asUnreachable = check({ ...base, ancestorOfBranch: false });
      assert.deepEqual(asAncestor, asUnreachable);
      const anyLive = files.some((f) => f.shape === 'live');
      assert.equal(asAncestor.verdict, anyLive ? 'violation' : 'clean');
      if (anyLive) liveSeen += 1;
      else revertedSeen += 1;
      if (asAncestor.verdict === 'violation') {
        assert.deepEqual(
          asAncestor.liveFiles.sort(),
          files.filter((f) => f.shape === 'live').map((f) => f.path).sort()
        );
      }
    }),
    { numRuns: 200 }
  );
  // asserted reachability floors, never hoped-for
  assert.ok(liveSeen >= 20, `only ${liveSeen} live states generated`);
  assert.ok(revertedSeen >= 20, `only ${revertedSeen} fully-clean states generated`);
});

// ── Invariant 2: already-on-main never yields a revert instruction ─────────

test('BL-954 invariant 2: an already-on-main bounce is a breach report and its output nowhere instructs a revert, whatever the content state', () => {
  let liveOnMainSeen = 0;
  fc.assert(
    fc.property(uniqueFilesArb, fc.boolean(), (files, ancestorOfBranch) => {
      const report = check({ commitOk: true, branchOk: true, ancestorOfMain: true, ancestorOfBranch, files });
      assert.equal(report.verdict, 'breach-report');
      assert.equal(report.remedy, null);
      assert.doesNotMatch(JSON.stringify(report), /revert/i);
      if (files.some((f) => f.shape === 'live')) liveOnMainSeen += 1;
    }),
    { numRuns: 200 }
  );
  // the dangerous corner - content still live AND published - must be reached
  assert.ok(liveOnMainSeen >= 20, `only ${liveOnMainSeen} live-content-on-main states generated`);
});

// ── Invariant 3: recording never contingent on the check ───────────────────
// Exercised over the REAL CLI main() with the seam forcing every outcome
// shape exhaustively (a sampled draw could miss one), fc varying the rest.

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function mkRepo() {
  const root = mkTmpDir('sfvc-bl954-inv3-');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  return root;
}

async function runCli(root, args) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    process.argv = ['node', 'record-bounce.js', ...args];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = previousArgv;
  }
  return JSON.parse(writes.join(''));
}

const OUTCOME_SHAPES = {
  clean: () => ({ verdict: 'clean', branch: BRANCH, commit: COMMIT, remedy: null, cause: null, liveFiles: [] }),
  violation: () => ({ verdict: 'violation', branch: BRANCH, commit: COMMIT, remedy: `on ${BRANCH}: git revert --no-edit ${COMMIT}`, cause: null, liveFiles: ['src/a.ts'] }),
  'breach-report': () => ({ verdict: 'breach-report', branch: BRANCH, commit: COMMIT, remedy: null, cause: null, liveFiles: [] }),
  undeterminable: () => ({ verdict: 'undeterminable', branch: BRANCH, commit: COMMIT, remedy: null, cause: 'the bounced commit cannot be resolved', liveFiles: [] }),
  throws: () => {
    throw new Error('forced check explosion');
  },
};

test('BL-954 invariant 3: every check outcome - including a throw - leaves the durable record written, and a failed check never reads as clean', { timeout: 120000 }, async () => {
  const shapes = Object.keys(OUTCOME_SHAPES);
  let commitCounter = 0;
  for (const shape of shapes) {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 999 }),
        fc.constantFrom('architect', 'cleaner', 'QA'),
        async (ticketNum, by) => {
          const root = mkRepo();
          commitCounter += 1;
          const commit = `c0ffee${String(commitCounter).padStart(4, '0')}`;
          const original = revertCheckSeam.run;
          revertCheckSeam.run = OUTCOME_SHAPES[shape];
          let result;
          try {
            result = await runCli(root, [
              '--ticket', `BL-${ticketNum}`,
              '--role', 'coder',
              '--type', 'defect',
              '--class', 'behavior',
              '--commit', commit,
              '--by', by,
            ]);
          } finally {
            revertCheckSeam.run = original;
          }
          const records = readBounceRecords(root);
          assert.equal(records.length, 1, `shape ${shape}: record lost`);
          assert.equal(records[0].commit, commit);
          assert.equal(result.recorded, true);
          if (shape === 'throws') {
            assert.equal(result.revertCheck.verdict, 'undeterminable');
            assert.match(result.revertCheck.cause, /forced check explosion/);
          } else {
            assert.equal(result.revertCheck.verdict, shape);
          }
        }
      ),
      { numRuns: 3 }
    );
  }
});
