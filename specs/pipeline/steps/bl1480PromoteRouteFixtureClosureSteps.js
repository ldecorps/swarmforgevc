'use strict';

// BL-1480 acceptance: the two promote_and_route_next standing fixtures derive
// their .bb copy set from the entry points they drive, and a fixture whose
// subprocess cannot load reports no passed checks.
//
// Every verdict here comes from the REAL mechanisms - BL-973's
// bbFixtureClosureGate (extended by this ticket for a multi-entry-point
// fixture), the real bb_closure_copy.sh helper, the real
// bb_fixture_load_guard.sh, computeClosure's real static bb parse, and the
// two standing tests run as the standing suite runs them - never from a
// restatement of what they should do.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_LIB = path.join(SCRIPTS, 'test', 'lib');
const { effectiveList, missingFromList, FIXTURES } = require('./lib/bbFixtureClosureGate.js');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');

const FEATURE_NAME = "BL-1480 The promote_and_route_next fixtures carry their subject's real bb closure";

// Scenario Outline placeholders are validated against explicit known values -
// an Examples row naming a file or entry this ticket does not own must fail
// loudly rather than quietly exercise nothing.
const KNOWN_FIXTURES = [
  'swarmforge/scripts/test/test_promote_and_route_next_priority.sh',
  'swarmforge/scripts/test/test_promote_and_route_next_no_limit_depth.sh',
];
const KNOWN_ENTRIES = ['promotion_gates_cli.bb', 'effective_backlog_depth_cli.bb'];

function knownFixture(file) {
  assert.ok(KNOWN_FIXTURES.includes(file), `unknown fixture example value "${file}"`);
  return file;
}

function knownEntry(entry) {
  assert.ok(KNOWN_ENTRIES.includes(entry), `unknown entry example value "${entry}"`);
  return entry;
}

function bash(script, env) {
  return spawnSync('bash', ['-c', `set -uo pipefail\n${script}`], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...(env || {}) },
  });
}

function mkTmp(ctx, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  ctx.bl1480.roots.push(dir);
  return dir;
}

// No vitest sweep runs here, so every temp tree this file makes is removed by
// this file (BL-420/BL-971).
function discard(ctx) {
  while (ctx.bl1480.roots.length) {
    fs.rmSync(ctx.bl1480.roots.pop(), { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the two promote_and_route_next fixtures that copy \.bb files into a disposable root$/, (ctx) => {
    ctx.bl1480 = { roots: [] };
    for (const file of KNOWN_FIXTURES) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `missing fixture ${file}`);
    }
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the fixture copy-list in "(.+)"$/, (ctx, file) => {
    ctx.bl1480.file = knownFixture(file);
    assert.ok(
      Object.prototype.hasOwnProperty.call(FIXTURES, file),
      `${file} is not enrolled in bbFixtureClosureGate's FIXTURES - an unenrolled fixture is exactly how these two rotted`
    );
  });

  scoped(/^the list is checked against the transitive load-file closure of "(.+)"$/, (ctx, entry) => {
    knownEntry(entry);
    // The fixture's EFFECTIVE list - what it actually copies for ALL its
    // declared entry points, run behaviourally, never parsed from source -
    // must be a superset of this ONE named entry's own closure. A fixture
    // that drives several entry points is still required to fully cover
    // each of them individually, not merely their union.
    const { files } = effectiveList(SCRIPTS, ctx.bl1480.file);
    const closure = computeClosure(SCRIPTS, entry);
    ctx.bl1480.entry = entry;
    ctx.bl1480.files = files;
    ctx.bl1480.missing = [...closure].filter((f) => !new Set(files).has(f)).sort();
  });

  scoped(/^no closure file is missing from the list$/, (ctx) => {
    const { entry, files, missing } = ctx.bl1480;
    assert.deepEqual(missing, [], `${ctx.bl1480.file} would not copy ${missing.join(', ')} for ${entry}`);
    assert.ok(files.length > 1, `the copy-list for ${entry} is suspiciously short: ${files.join(', ')}`);
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^a scratch tree in which "(.+)" gains one new load-file edge$/, (ctx, lib) => {
    assert.equal(lib, 'promotion_gates_lib.bb', `unknown lib example value "${lib}"`);
    const scratch = mkTmp(ctx, 'bl1480-scratch-');
    for (const name of fs.readdirSync(SCRIPTS)) {
      const from = path.join(SCRIPTS, name);
      if (fs.statSync(from).isFile()) {
        fs.copyFileSync(from, path.join(scratch, name));
      }
    }
    const added = 'bl1480_new_edge_lib.bb';
    fs.writeFileSync(path.join(scratch, added), '(def bl1480-new-edge true)\n');
    const target = path.join(scratch, lib);
    const source = fs.readFileSync(target, 'utf8');
    const anchor =
      '(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))';
    assert.ok(source.includes(anchor), 'the load-file idiom this scenario extends has changed');
    fs.writeFileSync(
      target,
      source.replace(
        anchor,
        `${anchor}\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${added}")))`
      )
    );
    ctx.bl1480.scratch = scratch;
    ctx.bl1480.added = added;
  });

  scoped(/^each promote_and_route_next fixture builds its disposable root$/, (ctx) => {
    // What a fixture DOES for its copy step is `copy_bb_closure "$SCRIPTS"
    // "$ROOT/..." <entry point(s)>`. That delegation is asserted from EACH
    // fixture's source - the question here is whether the fixture still
    // delegates, which is precisely a source question - and the derivation
    // itself is then run concretely against the scratch tree, once, for the
    // representative case (same posture as BL-1279's scenario of the same
    // name: source-check every known fixture, demonstrate the mechanism
    // once).
    for (const file of KNOWN_FIXTURES) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      assert.ok(
        source.includes('copy_bb_closure "$SCRIPTS" "$ROOT'),
        `${file} no longer derives its copy set from copy_bb_closure`
      );
      assert.ok(
        !/cp "\$SCRIPTS\/.*\.bb"/.test(source),
        `${file} still hand-lists its .bb copies`
      );
    }
    const entries = Array.isArray(FIXTURES[KNOWN_FIXTURES[1]].entry)
      ? FIXTURES[KNOWN_FIXTURES[1]].entry
      : [FIXTURES[KNOWN_FIXTURES[1]].entry];
    const dest = mkTmp(ctx, 'bl1480-root-');
    const run = bash(
      `source "${path.join(TEST_LIB, 'bb_closure_copy.sh')}"\ncopy_bb_closure "$SRC" "$DEST" ${entries.join(' ')}`,
      { SRC: ctx.bl1480.scratch, DEST: dest }
    );
    assert.equal(run.status, 0, `copy_bb_closure failed: ${run.stderr}`);
    ctx.bl1480.built = dest;
  });

  scoped(/^the newly required file is copied into that root without any copy-list being edited$/, (ctx) => {
    const landed = fs.readdirSync(ctx.bl1480.built);
    assert.ok(
      landed.includes(ctx.bl1480.added),
      `${ctx.bl1480.added} was not derived into the fixture root; got ${landed.join(', ')}`
    );
    discard(ctx);
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^the standing suite runs "(.+)"$/, (ctx, file) => {
    knownFixture(file);
    ctx.bl1480.run = bash(`bash "${path.join(REPO_ROOT, file)}"`);
  });

  scoped(/^the run exits zero and reports no failed check$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1480.run;
    const failures = `${stdout}${stderr}`.split('\n').filter((l) => l.startsWith('FAIL'));
    assert.deepEqual(failures, [], `failed checks:\n${failures.join('\n')}`);
    assert.equal(status, 0, `exited ${status}\n${stdout}\n${stderr}`);
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^a promote_and_route_next fixture missing one file from the entry point's closure$/, (ctx) => {
    const entry = 'promotion_gates_cli.bb';
    const root = mkTmp(ctx, 'bl1480-broken-');
    const built = bash(
      `source "${path.join(TEST_LIB, 'bb_closure_copy.sh')}"\ncopy_bb_closure "$SRC" "$DEST" ${entry}`,
      { SRC: SCRIPTS, DEST: root }
    );
    assert.equal(built.status, 0, `could not build the fixture root: ${built.stderr}`);
    ctx.bl1480.entry = entry;
    ctx.bl1480.removed = 'daemon_cycle_guard_lib.bb';
    fs.rmSync(path.join(root, ctx.bl1480.removed));
    ctx.bl1480.broken = root;
  });

  scoped(/^the test runs against that fixture$/, (ctx) => {
    ctx.bl1480.run = bash(
      `source "${path.join(TEST_LIB, 'bb_fixture_load_guard.sh')}"\n` +
        `assert_bb_closure_present "$SRC" "$FIXTURE" ${ctx.bl1480.entry}\n` +
        `echo "ok   - a check that must never be reached"`,
      { SRC: SCRIPTS, FIXTURE: ctx.bl1480.broken }
    );
  });

  scoped(/^the run fails and names the file that could not be loaded$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1480.run;
    assert.notEqual(status, 0, 'a fixture that cannot load must not exit zero');
    assert.ok(
      `${stdout}${stderr}`.includes(ctx.bl1480.removed),
      `the refusal does not name ${ctx.bl1480.removed}:\n${stdout}\n${stderr}`
    );
  });

  scoped(/^no check is reported as passed$/, (ctx) => {
    const { stdout, stderr } = ctx.bl1480.run;
    const passed = `${stdout}${stderr}`.split('\n').filter((l) => l.startsWith('ok'));
    assert.deepEqual(passed, [], `checks reported as passed against a subprocess that never ran:\n${passed.join('\n')}`);
    discard(ctx);
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  // missingFromList is the guard's own convenience entry point - the thing a
  // future maintainer reaches for to check a fixture, not the raw
  // effectiveList+computeClosure pairing scenario 01 exercises by hand. For a
  // single-entry fixture the two paths are the same call; for the no-limit
  // fixture's four-entry list they are not - missingFromList must UNION every
  // declared entry point's closure, and nothing else in this suite drives
  // that union path for a real multi-entry fixture (BL-973's and BL-1279's
  // own Outlines never name these two fixtures).
  //
  // A plain "missing is empty" check on the REAL fixture cannot discriminate
  // a mutant that collapses the union to entry[0] alone: the real fixture's
  // copy step (bb_closure_copy.sh, unaffected by this mutation) already
  // copies the full four-entry closure, so closure(entry[0]) - being a
  // subset of that - reads as fully satisfied either way (confirmed by
  // hand-mutating the union loop to `entryList(entry)[0]` and re-running:
  // this scenario still passed). So the probe is run against a SEPARATE
  // closureDir (same technique as scenario 02) carrying one new load-file
  // edge reachable ONLY through the second entry point - a mutant that
  // drops entries 2-4 from the union then fails to report it as missing.
  // BL-921/BL-922/BL-931: every throw in this step runs discard(ctx) first -
  // the scratch dir is created several statements before the last assertion
  // that can fail here, and this scenario's own Then step is a "must throw"
  // assertion (it exists to prove a mutant makes it fail), so a leak on this
  // path is not a hypothetical, it is the scenario's own passing behaviour.
  scoped(/^the guard's own missingFromList check runs against a closure carrying an edge reachable only through the second entry point$/, (ctx) => {
    const scratch = mkTmp(ctx, 'bl1480-union-probe-');
    try {
      for (const name of fs.readdirSync(SCRIPTS)) {
        const from = path.join(SCRIPTS, name);
        if (fs.statSync(from).isFile()) {
          fs.copyFileSync(from, path.join(scratch, name));
        }
      }
      const probe = 'bl1480_union_probe_lib.bb';
      fs.writeFileSync(path.join(scratch, probe), '(def bl1480-union-probe true)\n');
      const target = path.join(scratch, 'effective_backlog_depth_cli.bb');
      const source = fs.readFileSync(target, 'utf8');
      const anchor =
        '(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))';
      if (!source.includes(anchor)) {
        discard(ctx);
        assert.fail('the load-file idiom this scenario extends has changed');
      }
      fs.writeFileSync(
        target,
        source.replace(
          anchor,
          `${anchor}\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${probe}")))`
        )
      );
      ctx.bl1480.probe = probe;
      const result = missingFromList(SCRIPTS, ctx.bl1480.file, scratch);
      ctx.bl1480.entry = result.entry;
      ctx.bl1480.files = result.files;
      ctx.bl1480.missing = result.missing;
    } catch (err) {
      discard(ctx);
      throw err;
    }
  });

  scoped(/^the check covered all four of its declared entry points$/, (ctx) => {
    try {
      assert.ok(Array.isArray(ctx.bl1480.entry), `expected a multi-entry fixture, got: ${ctx.bl1480.entry}`);
      assert.equal(
        ctx.bl1480.entry.length,
        4,
        `expected all four declared entry points to be unioned, got: ${ctx.bl1480.entry.join(', ')}`
      );
    } catch (err) {
      discard(ctx);
      throw err;
    }
  });

  scoped(/^the closure walk reaches the edge behind the second entry point$/, (ctx) => {
    // The probe edge is reachable only through the SECOND entry point
    // (effective_backlog_depth_cli.bb). If missingFromList's union ever
    // collapsed to just entry[0], this file would never be walked and
    // "missing" would stay empty despite the fixture never copying it -
    // confirmed by hand-mutating the union loop to `entryList(entry)[0]`
    // and re-running this scenario: it failed to report the probe as
    // missing until the union was restored.
    try {
      assert.ok(
        ctx.bl1480.missing.includes(ctx.bl1480.probe),
        `expected the union to reach the probe edge via the second entry point; missing was: ${ctx.bl1480.missing.join(', ')}`
      );
    } finally {
      discard(ctx);
    }
  });
}

module.exports = { registerSteps };
