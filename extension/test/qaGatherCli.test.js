const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { checkoutSeededRepo } = require('./helpers/sharedRepoFixture');
const { main, parseArgs, resolveHeadCommit } = require('../out/tools/qa-gather');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'qa-gather.js');

// ── parseArgs (pure) ─────────────────────────────────────────────────────

test('parseArgs requires --ticket and returns undefined without it', () => {
  assert.equal(parseArgs([]), undefined);
  assert.equal(parseArgs(['--task', 'x', '--commit', 'abc1234567']), undefined);
});

test('parseArgs reads every flag when given', () => {
  assert.deepEqual(parseArgs(['--ticket', 'BL-1554-FIX', '--task', 't', '--commit', 'abc1234567', '--root', '/r']), {
    ticket: 'BL-1554-FIX',
    task: 't',
    commit: 'abc1234567',
    root: '/r',
  });
});

test('parseArgs with only --ticket leaves the rest undefined', () => {
  assert.deepEqual(parseArgs(['--ticket', 'BL-1554-FIX']), { ticket: 'BL-1554-FIX' });
});

test('parseArgs ignores an unrecognized flag rather than crashing or attributing it to a known one', () => {
  assert.deepEqual(parseArgs(['--bogus', 'x', '--ticket', 'BL-1554-FIX']), { ticket: 'BL-1554-FIX' });
});

test('parseArgs with a bare trailing --ticket (no value follows) returns undefined, same as an absent one', () => {
  assert.equal(parseArgs(['--task', 't', '--ticket']), undefined);
});

// ── resolveHeadCommit: real git (hardener pass, BL-1554) ────────────────

test('resolveHeadCommit returns the real short HEAD sha of a real git repo', () => {
  // BL-1039: no unit-lane test creates a git repository of its own - a
  // real repo comes from the shared seeded fixture (one filesystem copy,
  // no git spawn), never a direct `git init` here.
  const root = checkoutSeededRepo('bl1554-headcommit-');
  const expected = execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  assert.equal(resolveHeadCommit(root), expected);
  assert.equal(expected.length, 10);
});

test('resolveHeadCommit falls back to "unknown" (never throws) when the root is not a git repository', () => {
  const root = mkTmpDir('bl1554-nogit-');
  assert.equal(resolveHeadCommit(root), 'unknown');
});

// ── main() usage path (in-process, no subprocess reached) ───────────────
// The happy path (a real report over a real checklist run) is NOT tested
// here: main()'s only seam-free branch is argv parsing itself - reaching
// gatherQaChecklist's default runFn would spawn real npm test/property
// lanes from INSIDE a unit test, exactly what BL-1554's own acceptance
// suite exists to test instead, over an injected fake runner. That
// coverage lives in specs/pipeline/steps/bl1554QaGatherReportSteps.js.

async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stderr = [];
  process.stderr.write = (chunk) => {
    stderr.push(chunk);
    return true;
  };
  process.exitCode = undefined;
  try {
    process.argv = ['node', CLI, ...args];
    await main();
    return { stderr: stderr.join(''), exitCode: process.exitCode };
  } finally {
    process.stderr.write = originalStderrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() with no --ticket prints usage and exits 2, never a crash', async () => {
  const result = await runCli([]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Usage: node qa-gather\.js/);
});
