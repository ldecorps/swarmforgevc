const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { loadFileDeps, resolveScriptClosure, copyScriptClosure } = require('./helpers/pinnedRepoFixture');

// BL-1038-EXEMPT: this file must read the live scripts directory to assert the
// closure is materially SMALLER than it - the comparison IS the test. One
// readdirSync of names (no file contents) against a directory it exists to
// measure; converting it to a fixture would make the assertion vacuous.

// BL-1038: fixtures copied all 208 live .bb scripts (2.16MB) per build, so
// every new script in the repo slowed every fixture build forever. The closure
// of commit_integrity_cli.bb is 11 files and grows only with that CLI's own
// dependencies.

test('BL-1038: a load-file line yields its dependency', () => {
  assert.deepEqual(
    [...loadFileDeps('(load-file (str (fs/path (fs/parent *file*) "handoff_lib.bb")))')],
    ['handoff_lib.bb']
  );
});

test('BL-1038: a commented-out load-file is never a dependency', () => {
  // Several scripts document the exact incantation a caller would use.
  assert.deepEqual([...loadFileDeps(';;   (load-file (str (fs/path x "not_a_dep.bb")))')], []);
});

test('BL-1038: the closure is transitive and includes the entry point', () => {
  const sources = {
    'a.bb': '(load-file (str (fs/path x "b.bb")))',
    'b.bb': '(load-file (str (fs/path x "c.bb")))',
    'c.bb': '(defn f [])',
  };
  assert.deepEqual(
    [...resolveScriptClosure(['a.bb'], (n) => sources[n])].sort(),
    ['a.bb', 'b.bb', 'c.bb']
  );
});

test('BL-1038: a dependency cycle terminates', () => {
  const sources = { 'a.bb': '(load-file "b.bb")', 'b.bb': '(load-file "a.bb")' };
  assert.deepEqual([...resolveScriptClosure(['a.bb'], (n) => sources[n])].sort(), ['a.bb', 'b.bb']);
});

test('BL-1038: an unrelated script in the tree does NOT enter the closure', () => {
  // The whole point: the fixture's cost stops being a function of repo size.
  const sources = { 'a.bb': '(defn f [])', 'unrelated.bb': '(defn g [])' };
  assert.deepEqual([...resolveScriptClosure(['a.bb'], (n) => sources[n])], ['a.bb']);
});

test('BL-1038: copying the closure copies far less than the whole live directory', () => {
  const live = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  const target = path.join(mkTmpDir('bl1038-closure-'), 'scripts');
  const copied = copyScriptClosure(live, target, ['commit_integrity_cli.bb']);
  const allLive = fs.readdirSync(live).filter((f) => f.endsWith('.bb')).length;
  assert.ok(copied.length > 0, 'the closure must actually resolve');
  assert.ok(copied.includes('commit_integrity_cli.bb'), 'and include its entry point');
  assert.ok(copied.length < allLive / 4,
    `the closure (${copied.length}) must be far smaller than the live directory (${allLive})`);
  for (const name of copied) {
    assert.ok(fs.existsSync(path.join(target, name)), `${name} must actually land in the fixture`);
  }
});

test('BL-1038: a missing entry point throws rather than yielding a silent partial fixture', () => {
  const target = path.join(mkTmpDir('bl1038-missing-'), 'scripts');
  assert.throws(
    () => copyScriptClosure(path.join(__dirname, 'helpers'), target, ['definitely_not_here.bb']),
    /entry point definitely_not_here\.bb not found/,
    'a test failing later for a missing script is far harder to read than one failing here'
  );
});

test('BL-1038: a missing DEPENDENCY (not an entry point) is skipped, not thrown', () => {
  // resolveScriptClosure's own doc: "a name the reader cannot resolve is still
  // included ... but contributes no further edges" - copyScriptClosure must
  // honour that for anything that is not itself a requested entry point,
  // rather than throwing on every unresolvable name.
  const liveScriptsDir = mkTmpDir('bl1038-dep-source-');
  fs.writeFileSync(
    path.join(liveScriptsDir, 'a.bb'),
    '(load-file (str (fs/path x "missing_dep.bb")))'
  );
  const target = path.join(mkTmpDir('bl1038-dep-target-'), 'scripts');
  const copied = copyScriptClosure(liveScriptsDir, target, ['a.bb']);
  assert.deepEqual(copied, ['a.bb'], 'the entry point is copied and the absent dependency is silently dropped');
  assert.ok(fs.existsSync(path.join(target, 'a.bb')));
  assert.ok(!fs.existsSync(path.join(target, 'missing_dep.bb')));
});

// BL-1240: unregistered_test_gate_lib.bb is the first top-level script under
// swarmforge/scripts/ to load-file a dependency living in the test/
// subdirectory. The closure walker kept only the basename, so the copy looked
// for the file at the flat root, did not find it, and silently skipped it -
// leaving every fixture-built `bb swarm_handoff.bb` invocation dead on load.

test('BL-1240: a load-file into a subdirectory keeps the subdirectory', () => {
  assert.deepEqual(
    [
      ...loadFileDeps(
        '(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "test" "suite_inventory_lib.bb")))'
      ),
    ],
    ['test/suite_inventory_lib.bb']
  );
});

test('BL-1240: a dependency is resolved relative to the file that names it', () => {
  // A script inside test/ reaching back out with ".." names the root copy, not
  // a second one under test/.
  const sources = {
    'entry.bb': '(load-file (str (fs/path (fs/parent *file*) "test" "helper.bb")))',
    'test/helper.bb': '(load-file (str (fs/path (fs/parent *file*) ".." "shared.bb")))',
    'shared.bb': '(defn f [])',
  };
  assert.deepEqual(
    [...resolveScriptClosure(['entry.bb'], (n) => sources[n])].sort(),
    ['entry.bb', 'shared.bb', 'test/helper.bb']
  );
});

test('BL-1240: the copy reconstructs the subdirectory a dependency lives in', () => {
  const liveScriptsDir = mkTmpDir('bl1240-live-');
  fs.mkdirSync(path.join(liveScriptsDir, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(liveScriptsDir, 'a.bb'),
    '(load-file (str (fs/path (fs/parent *file*) "test" "sub.bb")))'
  );
  fs.writeFileSync(path.join(liveScriptsDir, 'test', 'sub.bb'), '(defn f [])');

  const target = path.join(mkTmpDir('bl1240-target-'), 'scripts');
  const copied = copyScriptClosure(liveScriptsDir, target, ['a.bb']);

  assert.deepEqual(copied.sort(), ['a.bb', 'test/sub.bb']);
  assert.ok(
    fs.existsSync(path.join(target, 'test', 'sub.bb')),
    'the dependency must land where the script that loads it looks for it'
  );
});

test('BL-1240: the live swarm_handoff.bb closure carries its test/ dependency', () => {
  // The regression itself, against the real tree: swarm_handoff.bb reaches
  // unregistered_test_gate_lib.bb, which reaches test/suite_inventory_lib.bb.
  const live = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  const target = path.join(mkTmpDir('bl1240-handoff-'), 'scripts');
  const copied = copyScriptClosure(live, target, ['swarm_handoff.bb']);

  assert.ok(
    copied.includes('unregistered_test_gate_lib.bb'),
    'the gate lib must be in swarm_handoff.bb\'s closure'
  );
  assert.ok(
    copied.includes('test/suite_inventory_lib.bb'),
    'the gate lib\'s test/ dependency must be in the closure'
  );
  assert.ok(
    fs.existsSync(path.join(target, 'test', 'suite_inventory_lib.bb')),
    'and must actually land in the fixture'
  );
});
