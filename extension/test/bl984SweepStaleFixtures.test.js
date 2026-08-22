const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  runAsPropertyLaneFixture,
  runManyAsPropertyLaneFixtures,
  sweepStaleFixtures,
} = require('./helpers/propertyLaneFixtureRunner');

// BL-984: a fixture stranded by a SIGKILLed run sits in extension/test/ -
// the one directory the property lane's include glob collects from - and
// is executed by every later full-lane run as a false red. Nothing traps
// SIGKILL, so cleanup-after can never close the hole; the guarantee is a
// sweep on the way IN. The sweep claims only files carrying the helper's
// own basename prefix whose originating run is gone (own pid means pid
// reuse from a dead run - this invocation has not written yet); a live
// peer's in-flight fixtures and a human's real property test survive.

const TEST_DIR = path.join(__dirname);

function plant(dir, name, content = "test('planted', () => {});\n") {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

// ── sweepStaleFixtures: what it claims ──────────────────────────────────

test('sweepStaleFixtures removes a prefixed fixture whose originating pid is gone', () => {
  const dir = mkTmpDir('bl984-sweep-');
  const stale = plant(dir, 'bl868-fixture-4242-abc123.property.test.js');
  const removed = sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir, isPidAlive: () => false });
  assert.equal(fs.existsSync(stale), false);
  assert.deepEqual(removed, [stale]);
});

test('sweepStaleFixtures removes a fixture carrying its OWN pid - pid reuse from a dead run, since this invocation has not written yet', () => {
  const dir = mkTmpDir('bl984-sweep-');
  const stale = plant(dir, `bl868-fixture-${process.pid}-abc123.property.test.js`);
  const removed = sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir, isPidAlive: () => true });
  assert.equal(fs.existsSync(stale), false);
  assert.deepEqual(removed, [stale]);
});

test('sweepStaleFixtures removes a runMany-shaped fixture (trailing index segment)', () => {
  const dir = mkTmpDir('bl984-sweep-');
  const stale = plant(dir, 'bl871-fixture-4242-abc123-7.property.test.js');
  sweepStaleFixtures({ basenamePrefix: 'bl871-fixture-', dir, isPidAlive: () => false });
  assert.equal(fs.existsSync(stale), false);
});

// ── sweepStaleFixtures: what it must never touch ────────────────────────

test('sweepStaleFixtures keeps a prefixed fixture whose originating pid is still alive', () => {
  const dir = mkTmpDir('bl984-sweep-');
  const peers = plant(dir, `bl868-fixture-${process.pid + 1}-abc123.property.test.js`);
  const removed = sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir, isPidAlive: () => true });
  assert.equal(fs.existsSync(peers), true);
  assert.deepEqual(removed, []);
});

test('sweepStaleFixtures keeps a property test that does not carry the helper prefix', () => {
  const dir = mkTmpDir('bl984-sweep-');
  const human = plant(dir, 'realFeature.property.test.js');
  sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir, isPidAlive: () => false });
  assert.equal(fs.existsSync(human), true);
});

test('sweepStaleFixtures keeps a prefixed name with no parseable pid segment', () => {
  const dir = mkTmpDir('bl984-sweep-');
  const odd = plant(dir, 'bl868-fixture-notapid.property.test.js');
  sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir, isPidAlive: () => false });
  assert.equal(fs.existsSync(odd), true);
});

test('sweepStaleFixtures keeps a prefixed pid-bearing file that is not a .property.test.js', () => {
  const dir = mkTmpDir('bl984-sweep-');
  const other = plant(dir, 'bl868-fixture-4242-abc123.property.test.js.log');
  sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir, isPidAlive: () => false });
  assert.equal(fs.existsSync(other), true);
});

test('sweepStaleFixtures sweeps only the prefix it was given - the sibling prefix survives', () => {
  const dir = mkTmpDir('bl984-sweep-');
  const bl868 = plant(dir, 'bl868-fixture-4242-abc123.property.test.js');
  const bl871 = plant(dir, 'bl871-fixture-4242-abc123.property.test.js');
  sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir, isPidAlive: () => false });
  assert.equal(fs.existsSync(bl868), false);
  assert.equal(fs.existsSync(bl871), true);
});

// ── default pid-aliveness: real processes, no stub ──────────────────────

test('default aliveness treats an impossible pid as gone and a live child as running', async () => {
  const dir = mkTmpDir('bl984-sweep-');
  const child = spawn('sleep', ['300'], { stdio: 'ignore' });
  try {
    const dead = plant(dir, 'bl868-fixture-99999999-abc123.property.test.js');
    const alive = plant(dir, `bl868-fixture-${child.pid}-abc123.property.test.js`);
    sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir });
    assert.equal(fs.existsSync(dead), false, 'a pid beyond any real pid range is gone');
    assert.equal(fs.existsSync(alive), true, 'a live child pid is a running peer');
  } finally {
    child.kill('SIGKILL');
  }
});

test('default aliveness treats a SIGKILLed-but-unreaped child (a zombie) as gone', () => {
  // The live SIGKILL case from the ticket's qa_e2e_procedure, reproduced
  // deterministically. `process.kill(pid, 0)` SUCCEEDS on a zombie - the
  // process is dead but its parent has not reaped it - so aliveness cannot
  // be decided by that signal probe alone. The window is not exotic here:
  // this helper is synchronous throughout, so blocking the event loop (as
  // spawnSync does for a whole run) keeps a killed child unreaped.
  const dir = mkTmpDir('bl984-sweep-');
  const child = spawn('sleep', ['60'], { stdio: 'ignore' });
  child.kill('SIGKILL');
  // Poll rather than sleep a fixed span: the zombie persists for as long as
  // the event loop stays blocked, so this settles immediately when the host
  // is idle and still holds under load instead of flaking into a false red.
  const procState = () => spawnSync('ps', ['-o', 'state=', '-p', String(child.pid)], { encoding: 'utf8' }).stdout || '';
  let state = procState();
  for (let i = 0; i < 30 && !/^\s*Z/.test(state); i += 1) {
    spawnSync('sleep', ['0.1']);
    state = procState();
  }
  assert.match(state, /^\s*Z/, 'precondition: the killed child is a zombie, not yet reaped');
  let signalProbeSaysAlive = true;
  try {
    process.kill(child.pid, 0);
  } catch (err) {
    signalProbeSaysAlive = err.code === 'EPERM';
  }
  assert.equal(signalProbeSaysAlive, true, 'precondition: kill(pid, 0) still succeeds on a zombie');

  const stale = plant(dir, `bl868-fixture-${child.pid}-abc123.property.test.js`);
  sweepStaleFixtures({ basenamePrefix: 'bl868-fixture-', dir });
  assert.equal(fs.existsSync(stale), false, "a zombie's run is over - its fixture is claimable");
});

// ── entry-point wiring: both entry points sweep before writing/spawning ──

function stubSpawn(record) {
  return (cmd, args, opts) => {
    record.push({ cmd, args, opts, dirListing: fs.readdirSync(TEST_DIR) });
    return { status: 0, stdout: 'stub', stderr: '' };
  };
}

test('runAsPropertyLaneFixture sweeps a stale strand before the child is spawned and targets only the file it wrote', () => {
  const strand = plant(TEST_DIR, 'bl868-fixture-99999999-stale0.property.test.js');
  const record = [];
  try {
    const result = runAsPropertyLaneFixture("test('x', () => {});\n", { spawnFn: stubSpawn(record) });
    assert.equal(fs.existsSync(strand), false, 'the strand must be gone after the run');
    assert.equal(record.length, 1);
    const strandSeenAtSpawn = record[0].dirListing.includes(path.basename(strand));
    assert.equal(strandSeenAtSpawn, false, 'the strand must be removed BEFORE the child spawn, not after');
    const targets = record[0].args.filter((a) => a.endsWith('.property.test.js'));
    assert.equal(targets.length, 1, 'exactly one target: the file this run wrote');
    assert.match(targets[0], /^test\/bl868-fixture-/);
    assert.equal(fs.existsSync(path.join(TEST_DIR, path.basename(targets[0]))), false, 'own fixture removed on the way out');
    assert.equal(result.status, 0);
  } finally {
    fs.rmSync(strand, { force: true });
  }
});

test('runManyAsPropertyLaneFixtures sweeps its own stale strands before spawning and targets exactly the files it wrote', () => {
  const strand = plant(TEST_DIR, 'bl871-fixture-99999999-stale0.property.test.js');
  const record = [];
  try {
    runManyAsPropertyLaneFixtures(["test('a', () => {});\n", "test('b', () => {});\n"], { spawnFn: stubSpawn(record) });
    assert.equal(fs.existsSync(strand), false);
    assert.equal(record[0].dirListing.includes(path.basename(strand)), false, 'swept before spawn');
    const targets = record[0].args.filter((a) => a.endsWith('.property.test.js'));
    assert.equal(targets.length, 2, 'exactly the two files this run wrote');
    for (const t of targets) {
      assert.match(t, /^test\/bl871-fixture-/);
      assert.equal(fs.existsSync(path.join(TEST_DIR, path.basename(t))), false, 'own fixtures removed on the way out');
    }
  } finally {
    fs.rmSync(strand, { force: true });
  }
});

test('a live peer strand in the real fixture directory survives an entry-point run', () => {
  const child = spawn('sleep', ['300'], { stdio: 'ignore' });
  const peer = plant(TEST_DIR, `bl868-fixture-${child.pid}-peer0.property.test.js`);
  try {
    runAsPropertyLaneFixture("test('x', () => {});\n", { spawnFn: stubSpawn([]) });
    assert.equal(fs.existsSync(peer), true, 'a still-running peer run owns its fixtures');
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(peer, { force: true });
  }
});
