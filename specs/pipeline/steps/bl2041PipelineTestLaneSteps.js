'use strict';

// BL-2041: step handlers for "Every acceptance-pipeline test file runs in a
// lane QA reads". Drives the REAL listPipelineTestFiles (the exact function
// recordTestDuration.js's main() calls) and node:test's own programmatic
// run() API against the real specs/pipeline/test files (scenario 01) or a
// disposable mkdtemp fixture (scenario 02) - never a restatement of either.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

// runnerAdapter.js's own documented fix for the identical hazard: this
// acceptance runner is itself a `node --test` process, so NODE_TEST_CONTEXT
// is already set in this process's own env; a spawned child inheriting it
// treats itself as a NESTED run and silently skips executing its files
// instead of running them - every spawn below that runs real test files
// must strip it first.
function envWithoutNodeTestContext() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_PIPELINE_TEST_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'test');
const BL1358_FILE = path.join(REAL_PIPELINE_TEST_DIR, 'bl1358MutantTimeCeiling.test.js');
const { listPipelineTestFiles } = require(path.join(REPO_ROOT, 'extension', 'scripts', 'testDurationRecorderLib'));

const FEATURE = 'BL-2041 Every acceptance-pipeline test file runs in a lane QA reads';

// node:test's own programmatic run() API carries a per-test `file` field
// that none of its CLI reporters (TAP, spec, junit - checked against all
// three before choosing this) print for a PASSING test, so "did every
// census file actually run" needs the API, not a parsed report. Run in a
// FRESH child process (never nested inside this already-running
// node:test-based acceptance runner - observed to report zero events when
// nested, Node's own test-context tracking) that prints one JSON line.
async function runFiles(files) {
  const script = `
const { run } = require('node:test');
(async () => {
  const stream = run({ files: ${JSON.stringify(files)} });
  const filesSeen = new Set();
  let pass = 0, fail = 0;
  const failures = [];
  for await (const event of stream) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (event.data && event.data.file) filesSeen.add(event.data.file);
      if (event.type === 'test:pass') pass += 1;
      else { fail += 1; failures.push({ file: event.data && event.data.file, name: event.data && event.data.name }); }
    }
  }
  process.stdout.write(JSON.stringify({ filesSeen: [...filesSeen], pass, fail, failures }));
})();
`;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: envWithoutNodeTestContext(),
  });
  if (result.status !== 0 && !result.stdout) {
    throw new Error(`runFiles subprocess failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout.trim());
  return { filesSeen: new Set(parsed.filesSeen), pass: parsed.pass, fail: parsed.fail, failures: parsed.failures };
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenario 01 ──────────────────────────────────────────────────────

  scoped(/^the test files under specs\/pipeline\/test, fixtures excluded$/, (ctx) => {
    // The exact function recordTestDuration.js's main() calls - reads the
    // real lane definition on the parcel commit, never a restatement.
    ctx.bl2041 = { realFiles: listPipelineTestFiles(REAL_PIPELINE_TEST_DIR) };
  });

  scoped(/^the lane QA's gather runs is executed on the parcel commit$/, async (ctx) => {
    ctx.bl2041.runResult = await runFiles(ctx.bl2041.realFiles);
  });

  scoped(/^every one of those files runs in it$/, (ctx) => {
    const expected = new Set(ctx.bl2041.realFiles);
    const seen = ctx.bl2041.runResult.filesSeen;
    const missing = [...expected].filter((f) => !seen.has(f));
    assert.deepEqual(missing, [], `expected every census file to run, missing: ${missing.join(', ')}`);
    assert.equal(ctx.bl2041.runResult.fail, 0, `expected every test to pass, got ${ctx.bl2041.runResult.fail} failures: ${JSON.stringify(ctx.bl2041.runResult.failures)}`);
  });

  scoped(/^the census of those files is 41, counted with find specs\/pipeline\/test -name '\*\.test\.js' -not -path '\*\/fixtures\/\*'$/, (ctx) => {
    const found = execFileSync('find', [REAL_PIPELINE_TEST_DIR, '-name', '*.test.js', '-not', '-path', '*/fixtures/*'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    })
      .split('\n')
      .filter(Boolean);
    assert.equal(found.length, 41, `expected find's own census to read 41, got ${found.length}`);
    assert.equal(ctx.bl2041.realFiles.length, 41, `expected listPipelineTestFiles to read 41, got ${ctx.bl2041.realFiles.length}`);
  });

  // ── scenario 02 ──────────────────────────────────────────────────────

  scoped(/^a fixture copy of the lane in which one specs\/pipeline\/test file asserts false$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl2041-lane-');
    mkdirp(path.join(root, 'steps'));
    fs.writeFileSync(
      path.join(root, 'a.test.js'),
      "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\ntest('a passes', () => { assert.equal(1, 1); });\n"
    );
    fs.writeFileSync(
      path.join(root, 'steps', 'b.test.js'),
      "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\ntest('b is red', () => { assert.equal(1, 2); });\n"
    );
    // fixtures/ holding a same-suffix file proves the exclusion, not just
    // an assumption that the directory is empty.
    mkdirp(path.join(root, 'fixtures'));
    fs.writeFileSync(path.join(root, 'fixtures', 'c.test.js'), 'module.exports = {};\n');

    ctx.bl2041 = { root, failingFile: path.join(root, 'steps', 'b.test.js') };
  });

  scoped(/^that lane is executed$/, (ctx) => {
    const files = listPipelineTestFiles(ctx.bl2041.root);
    assert.deepEqual(files, [path.join(ctx.bl2041.root, 'a.test.js'), ctx.bl2041.failingFile], 'expected the fixture census to exclude fixtures/');
    ctx.bl2041.result = spawnSync(process.execPath, ['--test', ...files], { encoding: 'utf8', env: envWithoutNodeTestContext() });
  });

  scoped(/^it exits non-zero and names the failing file$/, (ctx) => {
    assert.notEqual(ctx.bl2041.result.status, 0, `expected a non-zero exit, got ${ctx.bl2041.result.status}`);
    const out = `${ctx.bl2041.result.stdout}${ctx.bl2041.result.stderr}`;
    assert.ok(out.includes('b is red'), `expected the output to name the failing test, got:\n${out}`);
  });

  // ── scenario 03 ──────────────────────────────────────────────────────

  scoped(/^two invocations of specs\/pipeline\/test\/bl1358MutantTimeCeiling\.test\.js start together$/, (ctx) => {
    // A decoy root this test owns, named exactly as BL-1358's own fixture
    // would name a LIVE sibling's root (a different, definitely-alive pid -
    // 1, init, never this process) - a structural, non-timing-dependent
    // proof: the blind sweep this ticket replaced would delete ANY
    // "bl1358-ceiling-*" entry regardless of whose pid it names; the fixed
    // owner-aware sweep never does.
    const decoyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1358-ceiling-1-'));
    fs.writeFileSync(path.join(decoyRoot, 'owned-by-another-run.txt'), 'do not touch');

    const run = () =>
      new Promise((resolve) => {
        const child = require('node:child_process').spawn(process.execPath, ['--test', BL1358_FILE], {
          encoding: 'utf8',
          env: envWithoutNodeTestContext(),
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });

    ctx.bl2041 = { decoyRoot, runsPromise: Promise.all([run(), run()]) };
  });

  scoped(/^both finish$/, async (ctx) => {
    ctx.bl2041.results = await ctx.bl2041.runsPromise;
  });

  scoped(/^both pass$/, (ctx) => {
    for (const [i, r] of ctx.bl2041.results.entries()) {
      assert.equal(r.status, 0, `run ${i + 1} failed (exit ${r.status}):\n${r.stdout}${r.stderr}`);
    }
  });

  scoped(/^neither run removed a fixture root the other run still owned$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.bl2041.decoyRoot), 'the decoy root, owned by a different (always-alive) pid, must survive both runs');
    fs.rmSync(ctx.bl2041.decoyRoot, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
