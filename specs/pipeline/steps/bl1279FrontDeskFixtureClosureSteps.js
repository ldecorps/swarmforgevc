'use strict';

// BL-1279 acceptance: the four front-desk supervisor fixtures derive their .bb
// copy set from front_desk_supervisor.bb's transitive load-file closure, and a
// fixture whose subprocess cannot load reports no passed checks.
//
// Every verdict here comes from the REAL mechanisms - BL-973's
// bbFixtureClosureGate, the real bb_closure_copy.sh helper, the real
// bb_fixture_load_guard.sh, and the four tests run as the standing suite runs
// them - never from a restatement of what they should do.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_LIB = path.join(SCRIPTS, 'test', 'lib');
const ENTRY = 'front_desk_supervisor.bb';
const { missingFromList, FIXTURES } = require('./lib/bbFixtureClosureGate.js');

const FEATURE_NAME =
  'The front-desk supervisor fixtures derive their bb closure instead of hand-listing it';

// Scenario Outline placeholders are validated against explicit known values -
// an Examples row naming a file this ticket does not own must fail loudly
// rather than quietly exercise nothing.
const KNOWN_FIXTURES = [
  'swarmforge/scripts/test/test_front_desk_supervisor_bl622_refusal.sh',
  'swarmforge/scripts/test/test_front_desk_supervisor_tick.sh',
  'swarmforge/scripts/test/test_front_desk_supervisor_liveness.sh',
  'swarmforge/scripts/test/test_front_desk_supervisor_fleet_creds.sh',
];

function knownFixture(file) {
  assert.ok(KNOWN_FIXTURES.includes(file), `unknown fixture example value "${file}"`);
  return file;
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
  ctx.bl1279.roots.push(dir);
  return dir;
}

// No vitest sweep runs here, so every temp tree this file makes is removed by
// this file (BL-420/BL-971).
function discard(ctx) {
  while (ctx.bl1279.roots.length) {
    fs.rmSync(ctx.bl1279.roots.pop(), { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the front-desk supervisor fixtures that copy \.bb files into a disposable root$/, (ctx) => {
    ctx.bl1279 = { roots: [] };
    for (const file of KNOWN_FIXTURES) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `missing fixture ${file}`);
    }
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the fixture copy-list in "(.+)"$/, (ctx, file) => {
    ctx.bl1279.file = knownFixture(file);
    assert.ok(
      Object.prototype.hasOwnProperty.call(FIXTURES, file),
      `${file} is not enrolled in bbFixtureClosureGate's FIXTURES - an unenrolled fixture is exactly how these four rotted`
    );
  });

  scoped(/^the list is checked against the transitive load-file closure of "(.+)"$/, (ctx, entry) => {
    assert.equal(entry, ENTRY, `unknown entry point example value "${entry}"`);
    ctx.bl1279.verdict = missingFromList(SCRIPTS, ctx.bl1279.file);
  });

  scoped(/^no closure file is missing from the list$/, (ctx) => {
    const { entry, files, missing } = ctx.bl1279.verdict;
    assert.deepEqual(missing, [], `${ctx.bl1279.file} would not copy ${missing.join(', ')} for ${entry}`);
    assert.ok(files.length > 1, `the copy-list for ${entry} is suspiciously short: ${files.join(', ')}`);
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  scoped(/^a scratch tree in which "(.+)" gains one new load-file edge$/, (ctx, entry) => {
    assert.equal(entry, ENTRY, `unknown entry point example value "${entry}"`);
    const scratch = mkTmp(ctx, 'bl1279-scratch-');
    for (const name of fs.readdirSync(SCRIPTS)) {
      const from = path.join(SCRIPTS, name);
      if (fs.statSync(from).isFile()) {
        fs.copyFileSync(from, path.join(scratch, name));
      }
    }
    const added = 'bl1279_new_edge_lib.bb';
    fs.writeFileSync(path.join(scratch, added), '(def bl1279-new-edge true)\n');
    const supervisor = path.join(scratch, entry);
    const source = fs.readFileSync(supervisor, 'utf8');
    const anchor = '(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "process_table_lib.bb")))';
    assert.ok(source.includes(anchor), 'the load-file idiom this scenario extends has changed');
    fs.writeFileSync(
      supervisor,
      source.replace(
        anchor,
        `${anchor}\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${added}")))`
      )
    );
    ctx.bl1279.scratch = scratch;
    ctx.bl1279.added = added;
  });

  scoped(/^each front-desk supervisor fixture builds its disposable root$/, (ctx) => {
    // What a fixture DOES for its copy step is `copy_bb_closure "$SRC" "$d"
    // front_desk_supervisor.bb`. That delegation is asserted from each
    // fixture's source - the question here is whether the fixture still
    // delegates, which is precisely a source question - and the derivation
    // itself is then run against the scratch tree.
    for (const file of KNOWN_FIXTURES) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      assert.ok(
        source.includes(`copy_bb_closure "$SRC" "$d" ${ENTRY}`),
        `${file} no longer derives its copy set from ${ENTRY}'s closure`
      );
      assert.ok(
        !/cp "\$SRC\/front_desk_supervisor\.bb"/.test(source),
        `${file} still hand-lists its .bb copies`
      );
    }
    const dest = mkTmp(ctx, 'bl1279-root-');
    const run = bash(
      `source "${path.join(TEST_LIB, 'bb_closure_copy.sh')}"\ncopy_bb_closure "$SRC" "$DEST" ${ENTRY}`,
      { SRC: ctx.bl1279.scratch, DEST: dest }
    );
    assert.equal(run.status, 0, `copy_bb_closure failed: ${run.stderr}`);
    ctx.bl1279.built = dest;
  });

  scoped(/^the newly required file is copied into that root without any copy-list being edited$/, (ctx) => {
    const landed = fs.readdirSync(ctx.bl1279.built);
    assert.ok(
      landed.includes(ctx.bl1279.added),
      `${ctx.bl1279.added} was not derived into the fixture root; got ${landed.join(', ')}`
    );
    discard(ctx);
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^the standing suite runs "(.+)"$/, (ctx, file) => {
    knownFixture(file);
    ctx.bl1279.run = bash(`bash "${path.join(REPO_ROOT, file)}"`);
  });

  scoped(/^the run exits zero and reports no failed check$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1279.run;
    const failures = `${stdout}${stderr}`.split('\n').filter((l) => l.startsWith('FAIL'));
    assert.deepEqual(failures, [], `failed checks:\n${failures.join('\n')}`);
    assert.equal(status, 0, `exited ${status}\n${stdout}\n${stderr}`);
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^a front-desk supervisor fixture missing one file from the entry point's closure$/, (ctx) => {
    const root = mkTmp(ctx, 'bl1279-broken-');
    const built = bash(
      `source "${path.join(TEST_LIB, 'bb_closure_copy.sh')}"\ncopy_bb_closure "$SRC" "$DEST" ${ENTRY}`,
      { SRC: SCRIPTS, DEST: root }
    );
    assert.equal(built.status, 0, `could not build the fixture root: ${built.stderr}`);
    ctx.bl1279.removed = 'self_heal_telemetry_lib.bb';
    fs.rmSync(path.join(root, ctx.bl1279.removed));
    ctx.bl1279.broken = root;
  });

  scoped(/^the test runs against that fixture$/, (ctx) => {
    ctx.bl1279.run = bash(
      `source "${path.join(TEST_LIB, 'bb_fixture_load_guard.sh')}"\n` +
        `assert_bb_closure_present "$SRC" "$FIXTURE" ${ENTRY}\n` +
        `echo "ok   - a check that must never be reached"`,
      { SRC: SCRIPTS, FIXTURE: ctx.bl1279.broken }
    );
  });

  scoped(/^the run fails and names the file that could not be loaded$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1279.run;
    assert.notEqual(status, 0, 'a fixture that cannot load must not exit zero');
    assert.ok(
      `${stdout}${stderr}`.includes(ctx.bl1279.removed),
      `the refusal does not name ${ctx.bl1279.removed}:\n${stdout}\n${stderr}`
    );
  });

  scoped(/^no check is reported as passed$/, (ctx) => {
    const { stdout, stderr } = ctx.bl1279.run;
    const passed = `${stdout}${stderr}`.split('\n').filter((l) => l.startsWith('ok'));
    assert.deepEqual(passed, [], `checks reported as passed against a subprocess that never ran:\n${passed.join('\n')}`);
    discard(ctx);
  });
}

module.exports = { registerSteps };
