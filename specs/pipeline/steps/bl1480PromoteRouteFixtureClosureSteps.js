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
const { effectiveList, FIXTURES } = require('./lib/bbFixtureClosureGate.js');
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
}

module.exports = { registerSteps };
