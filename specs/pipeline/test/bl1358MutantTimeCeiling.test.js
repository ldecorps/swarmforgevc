'use strict';

// BL-1358: a mutant that will not finish is killed and reported.
//
// The wait is `runGeneratedTests`' spawnSync, and until this ticket nothing in
// the harness bounded it: a mutant that hangs held its worker until a human
// noticed. Measured 2026-09-03 at 808 seconds.
//
// Human ruling (2026-09-03): a timed-out mutant FAILS the gate, the same as a
// surviving mutant, and the ceiling is 300 seconds. These tests drive the real
// adapter and the real worker with a small ceiling - the value under test is
// that a ceiling exists and is honoured, not that 300s elapses.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGeneratedTests, resolveMutantTimeoutMs, DEFAULT_MUTANT_TIMEOUT_MS } = require('../runnerAdapter');
const { handle } = require('../mutationWorker');

const FIXTURE_PREFIX = 'bl1358-ceiling-';

// A killed run traps no `finally`, so the previous run's fixtures are swept by
// prefix BEFORE this one starts as well (BL-971). These roots are this test's
// own, one run at a time.
function sweepFixtures() {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
}

function mkFixture() {
  sweepFixtures();
  return fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
}

// A generated entry point that never finishes. The open INTERVAL is
// load-bearing and was learned the hard way: a bare `new Promise(() => {})`
// does not hang at all - node:test cancels it as soon as the event loop
// drains, so the child exits in milliseconds and there is nothing for a
// ceiling to catch. A live timer keeps the loop alive, which is the shape of
// every real hang the ticket names: a poll loop with no exit condition, a lock
// that never frees, a leaked client still holding its socket (BL-1357's own
// 808-second wedge polled a bridge every 20ms).
function writeHangingTest(dir, name = 'hang.test.js') {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    "const { test } = require('node:test');\n" +
      "test('never finishes', async () => {\n" +
      "  await new Promise(() => { setInterval(() => {}, 20); });\n" +
      '});\n',
    'utf8'
  );
  return file;
}

function writeFastTest(dir, name = 'fast.test.js') {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\n" +
      "test('finishes at once', () => { assert.equal(1, 1); });\n",
    'utf8'
  );
  return file;
}

test('BL-1358 01: a mutant that exceeds the ceiling is killed, and the call returns', () => {
  const dir = mkFixture();
  try {
    const startedAt = Date.now();
    const result = runGeneratedTests([writeHangingTest(dir)], { timeoutMs: 1500 });
    const elapsed = Date.now() - startedAt;

    assert.equal(result.timedOut, true, `expected a timeout verdict, got ${JSON.stringify(result)}`);
    assert.equal(result.success, false, 'a mutant that never finished was not proven killed');
    assert.equal(result.timeoutMs, 1500);
    // The worker is free for the next mutant: the call returned rather than
    // waiting the 808 seconds the incident ran.
    assert.ok(elapsed < 60_000, `the call took ${elapsed}ms - the ceiling did not end it`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1358 01b: killing reclaims the whole process group, never just the direct child', async () => {
  const dir = mkFixture();
  const pidFile = path.join(dir, 'grandchild.pid');
  try {
    // The mutant shells out, as a real scenario does. `sleep` is the
    // descendant that a kill of the direct child alone would orphan - this
    // repo has that scar already (kill -KILL -- -PGID, engineering rules).
    fs.writeFileSync(
      path.join(dir, 'spawner.test.js'),
      "const { test } = require('node:test');\n" +
        "const { spawn } = require('node:child_process');\n" +
        "const fs = require('node:fs');\n" +
        `test('spawns and hangs', async () => {\n` +
        `  const child = spawn('sleep', ['120'], { stdio: 'ignore' });\n` +
        `  fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));\n` +
        '  await new Promise(() => { setInterval(() => {}, 20); });\n' +
        '});\n',
      'utf8'
    );

    runGeneratedTests([path.join(dir, 'spawner.test.js')], { timeoutMs: 2000 });

    const grandchildPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(grandchildPid > 0, 'the fixture never recorded its descendant');
    // SIGKILL delivery and reaping are not instantaneous, so this is a BOUNDED
    // wait rather than an immediate read - and bounded rather than a fixed
    // sleep, so it neither flakes on a loaded host nor waits when it need not.
    // An unbounded wait here would be this very ticket's defect, in its test.
    const deadline = Date.now() + 5000;
    let alive = true;
    while (alive && Date.now() < deadline) {
      try {
        process.kill(grandchildPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, `descendant ${grandchildPid} survived the kill - the process group was not reclaimed`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1358 04: a mutant that finishes inside the ceiling is untouched', () => {
  const dir = mkFixture();
  try {
    const result = runGeneratedTests([writeFastTest(dir)], { timeoutMs: 30_000 });
    assert.equal(result.success, true, result.output);
    assert.notEqual(result.timedOut, true, 'a mutant that finished was reported as timed out');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1358: the ceiling is configurable, and defaults to the ruled 300 seconds', () => {
  assert.equal(DEFAULT_MUTANT_TIMEOUT_MS, 300_000, 'the human ruled a 300-second ceiling');

  const dir = mkFixture();
  try {
    // Raising it changes the behaviour: the same hang that times out at 1.5s
    // is still running when a generous ceiling is in force, so the call must
    // NOT report a timeout for a reason other than the ceiling itself.
    const tight = runGeneratedTests([writeHangingTest(dir)], { timeoutMs: 1200 });
    assert.equal(tight.timedOut, true);
    assert.equal(tight.timeoutMs, 1200);

    // Configured by environment as well as by argument, so a slow host can
    // raise it without editing code.
    const previous = process.env.GHERKIN_MUTATION_TIMEOUT_MS;
    process.env.GHERKIN_MUTATION_TIMEOUT_MS = '1300';
    try {
      const fromEnv = runGeneratedTests([writeHangingTest(dir, 'hang2.test.js')]);
      assert.equal(fromEnv.timedOut, true);
      assert.equal(fromEnv.timeoutMs, 1300);
    } finally {
      if (previous === undefined) delete process.env.GHERKIN_MUTATION_TIMEOUT_MS;
      else process.env.GHERKIN_MUTATION_TIMEOUT_MS = previous;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1358 02: the worker reports a timed-out mutant as its own outcome, naming it and the ceiling', () => {
  const dir = mkFixture();
  try {
    // A real worker request whose scenario never terminates: one step handler
    // that awaits forever, driven through the real generate -> run chain.
    const stepsPath = path.join(dir, 'steps.js');
    fs.writeFileSync(
      stepsPath,
      "'use strict';\n" +
        'function registerSteps(registry) {\n' +
        '  registry.define(/^it never returns$/, async () => {\n' +
        '    await new Promise(() => { setInterval(() => {}, 20); });\n' +
        '  });\n' +
        '}\n' +
        'module.exports = { registerSteps };\n',
      'utf8'
    );
    const featurePath = path.join(dir, 'feature.json');
    fs.writeFileSync(
      featurePath,
      JSON.stringify({
        name: 'hanging feature',
        scenarios: [{ name: 'hangs', steps: [{ keyword: 'Given', text: 'it never returns' }] }],
      }),
      'utf8'
    );

    const previous = process.env.GHERKIN_MUTATION_TIMEOUT_MS;
    process.env.GHERKIN_MUTATION_TIMEOUT_MS = '2000';
    let response;
    try {
      response = handle({ id: 'mutant-7', feature_json: featurePath, work_dir: dir }, stepsPath);
    } finally {
      if (previous === undefined) delete process.env.GHERKIN_MUTATION_TIMEOUT_MS;
      else process.env.GHERKIN_MUTATION_TIMEOUT_MS = previous;
    }

    // Invariant 1: never folded into detected (test_failure) or into surviving
    // (test_success). It lands in the report's own third bucket, which
    // classifyOutcome already fails the gate on - the human's option 1.
    assert.equal(response.outcome, 'infrastructure_error');
    assert.notEqual(response.outcome, 'test_failure');
    assert.notEqual(response.outcome, 'test_success');
    assert.equal(response.timed_out, true);
    assert.equal(response.id, 'mutant-7');
    // Named, with the ceiling it exceeded.
    assert.match(String(response.error), /mutant-7/);
    assert.match(String(response.error), /2000/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1358 03: one mutant timing out leaves every other mutant carrying its ordinary outcome', () => {
  const dir = mkFixture();
  try {
    const passing = runGeneratedTests([writeFastTest(dir, 'a.test.js')], { timeoutMs: 30_000 });
    const hanging = runGeneratedTests([writeHangingTest(dir, 'b.test.js')], { timeoutMs: 1500 });
    // The run continues past the timeout: a mutant AFTER the hung one still
    // gets its ordinary verdict, which is what "the run stays useful" means.
    const failingFile = path.join(dir, 'c.test.js');
    fs.writeFileSync(
      failingFile,
      "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\n" +
        "test('fails', () => { assert.equal(1, 2); });\n",
      'utf8'
    );
    const failing = runGeneratedTests([failingFile], { timeoutMs: 30_000 });

    assert.equal(passing.success, true);
    assert.notEqual(passing.timedOut, true);
    assert.equal(hanging.timedOut, true);
    assert.equal(failing.success, false);
    assert.notEqual(failing.timedOut, true, 'an ordinary failure was reported as a timeout');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BL-1358 05: resolveMutantTimeoutMs falls back to the default on a non-positive or unparseable override', () => {
  // Direct unit coverage of the guard itself - Node's spawnSync treats
  // timeout:0 as NO TIMEOUT AT ALL and throws on a negative timeout, so a
  // broken override reaching either value would silently (or fatally)
  // disable the very ceiling this ticket exists to install. Verified against
  // Node's own spawnSync semantics, not assumed: `spawnSync('sleep',['1'],
  // {timeout:0})` runs unbounded; `{timeout:-5}` throws a RangeError.
  const previousEnv = process.env.GHERKIN_MUTATION_TIMEOUT_MS;
  delete process.env.GHERKIN_MUTATION_TIMEOUT_MS;
  try {
    assert.equal(resolveMutantTimeoutMs('0'), DEFAULT_MUTANT_TIMEOUT_MS, 'a zero override must not disable the ceiling');
    assert.equal(resolveMutantTimeoutMs(0), DEFAULT_MUTANT_TIMEOUT_MS, 'a numeric zero override must not disable the ceiling');
    assert.equal(resolveMutantTimeoutMs('-5'), DEFAULT_MUTANT_TIMEOUT_MS, 'a negative override must not reach spawnSync');
    assert.equal(resolveMutantTimeoutMs('not-a-number'), DEFAULT_MUTANT_TIMEOUT_MS, 'an unparseable override must not reach spawnSync');
    assert.equal(resolveMutantTimeoutMs(undefined), DEFAULT_MUTANT_TIMEOUT_MS, 'no override at all uses the default');
    // Non-vacuity: a genuinely valid override IS honored, so the guard is
    // rejecting specific bad values, not silently discarding every override.
    assert.equal(resolveMutantTimeoutMs('4200'), 4200, 'a valid positive override is honored');
  } finally {
    if (previousEnv === undefined) delete process.env.GHERKIN_MUTATION_TIMEOUT_MS;
    else process.env.GHERKIN_MUTATION_TIMEOUT_MS = previousEnv;
  }
});

test('BL-1358 06: a zero GHERKIN_MUTATION_TIMEOUT_MS resolves to the default, not to no-timeout-at-all', () => {
  // The env-var path specifically, since that is the reachable-by-typo
  // surface the ticket's own comment names ("no ceiling is the state this
  // ticket exists to end... must not be reachable through a typo in an env
  // var"). Driven through the real runGeneratedTests -> resolveMutantTimeoutMs
  // chain, but with a FAST-finishing scenario: waiting out the real 300s
  // default to prove it fired would make this test itself the very hang the
  // ticket exists to bound. Reading `result.timeoutMs` back proves the
  // resolution happened without needing the ceiling to actually elapse.
  const previous = process.env.GHERKIN_MUTATION_TIMEOUT_MS;
  process.env.GHERKIN_MUTATION_TIMEOUT_MS = '0';
  const dir = mkFixture();
  try {
    const result = runGeneratedTests([writeFastTest(dir, 'zero-env.test.js')]);
    assert.equal(result.success, true, result.output);
    assert.equal(
      result.timeoutMs,
      DEFAULT_MUTANT_TIMEOUT_MS,
      'GHERKIN_MUTATION_TIMEOUT_MS=0 must resolve to the default ceiling, never to spawnSync timeout:0 (no timeout at all)'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.GHERKIN_MUTATION_TIMEOUT_MS;
    else process.env.GHERKIN_MUTATION_TIMEOUT_MS = previous;
  }
});
