'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fc = require('fast-check');
const { mkTmpDir, listTmpDirNames } = require('./helpers/tmpDir');

// BL-1754 declared invariants
// (backlog/active/BL-1754-a-role-asks-another-role-a-question-through-a-one-shot-read-only-helper.yaml):
//
// 1. "The helper never writes to the repository, a mailbox or the backlog;
//    its only durable output is its own question record under
//    .swarmforge/."
// 2. "When the CLI returns - answer, refusal or timeout - no process it
//    started is alive."

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'peer_question.bb');
const FIXTURE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'peer_question_fixture.sh');

function buildFixture(root, provider) {
  const args = [FIXTURE_SH, root];
  if (provider !== 'claude') args.push('--to-provider', `specifier=${provider}`);
  const made = spawnSync('bash', args, { encoding: 'utf8' });
  assert.equal(made.status, 0, `peer_question_fixture.sh failed:\n${made.stderr}`);
}

// BL-1754 D1 (QA bounce 4f729861ee): the CLI's own run-dir (prompt.md,
// answer.txt, stderr.log) lives under os.tmpdir(), never under the fixture
// root - gitStatusPaths' diff of the fixture root cannot see a leak there.
// This is the only durable side channel a leak could hide in: the CLI
// takes no other directory as input, so every bl1754-peer-question-* entry
// under the real OS temp dir at test time was created by a CLI run this
// process started. Uses tmpDir.js's listTmpDirNames (BL-1623) rather than
// listing the temp dir directly in this file - that shape is exactly what
// blindTmpDirSweepGuard.test.js refuses inside any `*.property.test.js`
// file.
function bl1754RunDirs(dir) {
  return listTmpDirNames('bl1754-peer-question-', dir);
}

function gitStatusPaths(root) {
  const res = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(res.status, 0, `git status failed: ${res.stderr}`);
  return new Set(
    res.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
  );
}

function runCli(root, question, extraArgs, env, javaTmpDir) {
  const binDir = path.join(root, 'fake-bin');
  // CLAUDE_FAKE_LOG is required by the fake claude script itself (it
  // aborts immediately, before doing anything else, when unset) - every
  // call sets it, even when a test has no interest in reading it back.
  const fullEnv = {
    ...process.env,
    CLAUDE_FAKE_LOG: path.join(root, 'claude-calls.log'),
    ...env,
    PATH: `${binDir}:${process.env.PATH}`,
  };
  // BL-1827: -Djava.io.tmpdir=<javaTmpDir> ahead of the script on the bb
  // command line, so THIS call's run-dir lands under a parent no other
  // concurrent bb process uses - never the shared os.tmpdir() every
  // concurrent peer_question.bb call (a sibling run of this file, or a
  // live role's own question) also writes into. Optional: invariant 2's
  // own call has no interest in where the run-dir lands and omits it.
  const args = [
    ...(javaTmpDir ? [`-Djava.io.tmpdir=${javaTmpDir}`] : []),
    CLI, root, '--from', 'QA', '--to', 'specifier', '--question', question, ...extraArgs,
  ];
  return spawnSync('bb', args, { encoding: 'utf8', env: fullEnv });
}

// GENERATOR REACH (invariant 1): the four shapes the CLI's own branches can
// end in - answered, refused (an unsupported provider, never reaching
// claude at all), timed out, and a bare nonzero claude exit that is neither
// - each get their OWN fc.assert below, over the random question dimension,
// so every branch that could plausibly reach for an unguarded write is
// GUARANTEED exercised at least once - never left to fc.constantFrom's own
// sampling to happen to draw all four out of a shared run budget.
const OUTCOMES = ['answered', 'refused', 'timed-out', 'failed'];

test.each(OUTCOMES)('invariant 1 (%s): the only filesystem change is a new record under .swarmforge/peer-questions/', (outcome) => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes('"') && s.trim().length > 0),
      (question) => {
        const root = mkTmpDir('bl1754-prop-inv1-');
        const provider = outcome === 'refused' ? 'aider' : 'claude';
        buildFixture(root, provider);

        const before = gitStatusPaths(root);

        // BL-1827: this call's own temp parent, used ONLY as
        // -Djava.io.tmpdir for this one bb invocation - never the shared
        // os.tmpdir() a concurrent creator (another run of this file, or a
        // live role's own peer question) also writes into. Fresh per call,
        // so there is nothing to snapshot beforehand: any
        // bl1754-peer-question-* entry found under it afterward was made by
        // THIS call and this call alone.
        const javaTmpDir = mkTmpDir('bl1754-run-parent-');

        const env = {};
        const extraArgs = [];
        if (outcome === 'timed-out') {
          env.CLAUDE_FAKE_SLEEP_S = '30';
          extraArgs.push('--timeout-s', '1');
        }
        if (outcome === 'failed') {
          env.CLAUDE_FAKE_EXIT = '1';
        }

        try {
          runCli(root, question, extraArgs, env, javaTmpDir);

          const after = gitStatusPaths(root);
          // claude-calls.log is written by the FAKE claude harness itself
          // (this test's own recording mechanism), never by peer_question.bb -
          // excluded from "added", the same way the fixture's own pre-existing
          // files are excluded by being in `before` already.
          const added = [...after].filter((p) => !before.has(p) && p !== 'claude-calls.log');
          const removed = [...before].filter((p) => !after.has(p));

          assert.deepEqual(removed, [], `outcome=${outcome}: expected nothing to disappear from git status, got: ${JSON.stringify(removed)}`);
          for (const p of added) {
            assert.ok(
              p.startsWith('.swarmforge/peer-questions/'),
              `outcome=${outcome}: expected every new path to be under .swarmforge/peer-questions/, got: ${p}`
            );
          }

          // BL-1754 D1: the run-dir (prompt.md/answer.txt/stderr.log) lives
          // under java.io.tmpdir, outside the fixture root, so it is
          // invisible to the git-status diff above. Every outcome -
          // answered, refused, timed-out, failed - must leave zero
          // bl1754-peer-question-* entries under THIS call's own temp
          // parent once the CLI has returned.
          const leakedRunDirs = bl1754RunDirs(javaTmpDir);
          assert.deepEqual(
            [...leakedRunDirs],
            [],
            `outcome=${outcome}: expected no leaked run-dir under this call's own temp parent, got: ${JSON.stringify([...leakedRunDirs])}`
          );
        } finally {
          fs.rmSync(javaTmpDir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 5 }
  );
});

// GENERATOR REACH (invariant 2): the two regimes the code must handle
// correctly - the child exits on its own well inside the bound
// (sleepS < boundS, no kill needed) and the child overruns the bound and
// must be killed (sleepS > boundS) - are each named explicitly below with
// two (boundS, sleepS) pairs apiece, GUARANTEEING both are reached rather
// than sampled for. The state space here is two small integers, not an
// unbounded domain a generator earns its keep exploring, so reach is
// asserted by enumeration rather than hoped for from fc.constantFrom's own
// sampling over a shared run budget.
const INV2_CASES = [
  [1, 0], // exits well inside a 1s bound
  [2, 1], // exits well inside a 2s bound
  [1, 4], // overruns a 1s bound - must be killed
  [2, 6], // overruns a 2s bound - must be killed
];

test.each(INV2_CASES)(
  'invariant 2 (boundS=%i sleepS=%i): no process the helper started is alive once it returns, and it does not wait out an overrun child',
  (boundS, sleepS) => {
    const root = mkTmpDir('bl1754-prop-inv2-');
    buildFixture(root, 'claude');
    const pidFile = path.join(root, 'claude.pid');

    const env = { CLAUDE_FAKE_PIDFILE: pidFile };
    if (sleepS > 0) env.CLAUDE_FAKE_SLEEP_S = String(sleepS);

    const startedAt = Date.now();
    runCli(root, 'q?', ['--timeout-s', String(boundS)], env);
    const elapsedS = (Date.now() - startedAt) / 1000;

    assert.ok(fs.existsSync(pidFile), `boundS=${boundS} sleepS=${sleepS}: expected the fake to have recorded its own pid`);
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.ok(!alive, `boundS=${boundS} sleepS=${sleepS}: expected pid ${pid} to be dead once the CLI returned`);

    if (sleepS > boundS) {
      // Overrun: the CLI must return near its OWN bound, never wait out
      // the child's full sleep - the difference between actually killing
      // an overrun child and merely waiting for one that happens to be
      // finite.
      assert.ok(
        elapsedS < sleepS - 0.5,
        `boundS=${boundS} sleepS=${sleepS}: expected the CLI to return near the bound, not wait out the full sleep - took ${elapsedS}s`
      );
    }
  }
);

module.exports = {};
