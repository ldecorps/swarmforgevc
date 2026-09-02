const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  loadFileDeps,
  resolveDepPath,
  resolveScriptClosure,
  copyScriptClosure,
} = require('./helpers/pinnedRepoFixture');

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

test('BL-1294: a missing DEPENDENCY (not an entry point) fails the copy naming it, not silently skipped', () => {
  // Was: "a name the reader cannot resolve is still included ... but
  // contributes no further edges" was read as license for copyScriptClosure to
  // skip it. That produced exactly the quietly-incomplete fixture the
  // resolver's own contract promises never to build - see BL-1294.
  const liveScriptsDir = mkTmpDir('bl1294-dep-source-');
  fs.writeFileSync(
    path.join(liveScriptsDir, 'a.bb'),
    '(load-file (str (fs/path x "missing_dep.bb")))'
  );
  const target = path.join(mkTmpDir('bl1294-dep-target-'), 'scripts');
  assert.throws(
    () => copyScriptClosure(liveScriptsDir, target, ['a.bb']),
    /dependency missing_dep\.bb not found/,
    'an unresolvable dependency must fail the build naming it, never silently shrink the fixture'
  );
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

// BL-1240 (architect bounce D1): two load-file idioms look identical to a
// segments-before-the-filename rule and mean different anchors.
//
//   (fs/path (fs/parent *file*) "test" "x.bb")          -> relative to the
//                                                          referring file
//   (fs/path repo-root "swarmforge" "scripts" "x.bb")   -> the scripts root
//
// Reading the second as the first produces `test/swarmforge/scripts/x.bb`,
// which exists nowhere, and copyScriptClosure then silently skips it — the
// exact failure class this ticket exists to close, reintroduced for four
// files the first blast-radius sweep missed.

test('BL-1240: the repo-root "swarmforge" "scripts" idiom anchors at the scripts root', () => {
  assert.deepEqual(
    [
      ...loadFileDeps(
        '(load-file (str (fs/path repo-root "swarmforge" "scripts" "cursor_seat_guard_lib.bb")))'
      ),
    ],
    ['swarmforge/scripts/cursor_seat_guard_lib.bb'],
    'the segments are kept verbatim; the ANCHOR is what resolveDepPath decides'
  );
  assert.equal(
    resolveDepPath('test/cursor_seat_guard_lib_test_runner.bb', 'swarmforge/scripts/cursor_seat_guard_lib.bb'),
    'cursor_seat_guard_lib.bb',
    'a scripts-root anchor must not be joined onto the referring file\'s directory'
  );
  // ...and the other idiom keeps meaning what it meant.
  assert.equal(
    resolveDepPath('unregistered_test_gate_lib.bb', 'test/suite_inventory_lib.bb'),
    'test/suite_inventory_lib.bb'
  );
  assert.equal(
    resolveDepPath('test/ambulance_lib_test_runner.bb', '../ambulance_lib.bb'),
    'ambulance_lib.bb'
  );
});

test('BL-1240: a scripts-root anchor reached through .. resolves the same way', () => {
  // specs/pipeline/steps/lib's own bb drivers climb out and back in.
  assert.equal(
    resolveDepPath('test/x_test_runner.bb', '../../swarmforge/scripts/handoff_lib.bb'),
    'handoff_lib.bb'
  );
});

test('BL-1240: no load-file target in the live tree is resolved to the wrong anchor', () => {
  // The blast-radius check the first pass got wrong, done exhaustively this
  // time: walk every .bb in the live scripts tree and resolve every
  // dependency it names. The mis-anchoring signature is precise - the
  // resolved path is not there, but a file of that basename IS somewhere in
  // the tree - so a name that exists nowhere at all (a test fixture's own
  // "a.bb") is correctly not a finding, while `swarmforge/scripts/x.bb`
  // resolved to `test/swarmforge/scripts/x.bb` is.
  const live = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  const walk = (dir, rel = '') =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name), `${rel}${e.name}/`)
        : e.name.endsWith('.bb')
          ? [`${rel}${e.name}`]
          : []
    );

  const all = walk(live);
  const byBasename = new Set(all.map((f) => path.posix.basename(f)));
  const present = new Set(all);
  const exists = (candidate) => present.has(candidate);

  const misanchored = [];
  let multiSegment = 0;
  for (const file of all) {
    for (const dep of loadFileDeps(fs.readFileSync(path.join(live, file), 'utf8'))) {
      if (dep.includes('/')) multiSegment += 1;
      const resolved = resolveDepPath(file, dep, exists);
      if (!present.has(resolved) && byBasename.has(path.posix.basename(resolved))) {
        misanchored.push(`${file} -> ${dep} => ${resolved}`);
      }
    }
  }

  assert.deepEqual(misanchored, [], 'a load-file target resolved to the wrong anchor');
  // Non-vacuity: the sweep really did meet the multi-segment cases it exists
  // for, rather than passing because every dependency was a bare basename.
  assert.ok(multiSegment > 100, `expected many multi-segment targets, saw ${multiSegment}`);
});

test('BL-1240: the live closure of a scripts-root-idiom entry point carries its dependency', () => {
  // The architect's own repro, as a test.
  const live = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
  const target = path.join(mkTmpDir('bl1240-idiom-'), 'scripts');
  const copied = copyScriptClosure(live, target, ['test/cursor_seat_guard_lib_test_runner.bb']);

  assert.ok(
    copied.includes('cursor_seat_guard_lib.bb'),
    `the dependency is missing from the closure: ${JSON.stringify(copied)}`
  );
  assert.ok(fs.existsSync(path.join(target, 'cursor_seat_guard_lib.bb')));
});
