'use strict';

// BL-1279's two declared invariants, coder-authored (BL-654), in the property
// lane (`npm run test:properties`) only.
//
// Invariant 1 - "Every .bb file a front-desk supervisor fixture copies is
// derived from front_desk_supervisor.bb's transitive load-file closure at run
// time, never read from a hand-maintained list."
//
//   A hand-maintained list and a derived one are indistinguishable on the
//   tree they were written against - which is exactly why four lists sat
//   wrong for months. They are told apart only by a closure the list's author
//   could not have known: so every draw MUTATES the tree, adding load-file
//   edges the shipped source does not have, and asserts the copy set still
//   equals the closure exactly. A hand-list fails every such draw by
//   construction; there is no lucky pass.
//
//   Reach is constructed on the axis that matters - DEPTH. An edge added to
//   the entry point itself is found by any one-level scan; an edge added to a
//   lib the entry point loads is found only by a transitive walk. Both depths
//   are drawn, each with its own floor, because a one-level implementation
//   would pass a depth-1-only property forever.
//
// Invariant 2 - "A fixture whose bb subprocess dies before its first assertion
// fails the run; no check may be reported as passed when the process under
// test never started."
//
//   Drawn over the closure MEMBER removed, because the hazard is per-file:
//   the crash-satisfied assertions in the original defect were satisfied by a
//   death at ONE specific edge, and a guard keyed to that filename would look
//   just as green. Every member of the real closure is removed in turn (the
//   domain is finite and enumerable, so the floor is exhaustive coverage of
//   it), and the run must refuse, name the file, and report NO passed check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { spawnSync } = require('node:child_process');
const { mkSharedTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor } = require('./helpers/reachFloors');

const EXTENSION_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.dirname(EXTENSION_ROOT);
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_LIB = path.join(SCRIPTS, 'test', 'lib');
const ENTRY = 'front_desk_supervisor.bb';

const LOAD_LINE = (name) =>
  `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${name}")))`;

function bash(script, env) {
  return spawnSync('bash', ['-c', `set -uo pipefail\n${script}`], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...(env || {}) },
  });
}

function closureOf(scriptsDir, entry) {
  const out = spawnSync('bb', [path.join(scriptsDir, 'bb_load_closure_cli.bb'), scriptsDir, entry], {
    encoding: 'utf8',
  });
  assert.equal(out.status, 0, `closure CLI failed: ${out.stderr}`);
  return out.stdout.split('\n').filter(Boolean).sort();
}

// What a fixture does for its copy step, run against an arbitrary source tree.
function derivedCopySet(scriptsDir, dest) {
  const run = bash(
    `source "${path.join(TEST_LIB, 'bb_closure_copy.sh')}"\ncopy_bb_closure "$SRC" "$DEST" ${ENTRY}`,
    { SRC: scriptsDir, DEST: dest }
  );
  assert.equal(run.status, 0, `copy_bb_closure failed: ${run.stderr}`);
  return fs.readdirSync(dest).filter((f) => f.endsWith('.bb')).sort();
}

function copyScriptsTree(dest) {
  for (const name of fs.readdirSync(SCRIPTS)) {
    const from = path.join(SCRIPTS, name);
    if (fs.statSync(from).isFile()) {
      fs.copyFileSync(from, path.join(dest, name));
    }
  }
}

const DEPTHS = ['at the entry point', 'inside a lib it loads'];
const DEPTH_FLOOR = 3;

describe('BL-1279 invariant 1: the copy set is derived from the closure, never hand-listed', () => {
  it('copies exactly the closure however the tree gains load-file edges', () => {
    const coverage = {};
    // One fc.assert per depth: the floor is then met by construction, not by
    // hoping a uniform constantFrom draw covered both.
    for (const drawnDepth of DEPTHS) {
      fc.assert(
        fc.property(
          fc.constant(drawnDepth),
          fc.integer({ min: 1, max: 3 }),
          (depth, extra) => {
            coverage[depth] = (coverage[depth] || 0) + 1;
            const root = mkSharedTmpDir('bl1279-prop-src-');
            const dest = mkSharedTmpDir('bl1279-prop-dest-');
            try {
              copyScriptsTree(root);
              const added = [];
              for (let i = 0; i < extra; i += 1) {
                const name = `bl1279_prop_edge_${depth === DEPTHS[0] ? 'entry' : 'lib'}_${i}.bb`;
                fs.writeFileSync(path.join(root, name), `(def bl1279-prop-${i} true)\n`);
                added.push(name);
              }
              // Depth 1 hangs the new edges off the entry point; depth 2 hangs
              // them off a lib the entry point loads, so only a TRANSITIVE walk
              // reaches them.
              const host = depth === DEPTHS[0] ? ENTRY : 'front_desk_supervisor_lib.bb';
              const hostPath = path.join(root, host);
              const anchor = depth === DEPTHS[0] ? LOAD_LINE('process_table_lib.bb') : null;
              const source = fs.readFileSync(hostPath, 'utf8');
              const injected = added.map(LOAD_LINE).join('\n');
              if (anchor) {
                assert.ok(source.includes(anchor), 'the load-file idiom this property extends has changed');
                fs.writeFileSync(hostPath, source.replace(anchor, `${anchor}\n${injected}`));
              } else {
                // A lib has no (-main); prepending is safe and keeps the edge
                // transitive rather than direct.
                fs.writeFileSync(hostPath, `${injected}\n${source}`);
              }

              const copied = derivedCopySet(root, dest);
              const closure = closureOf(root, ENTRY);

              assert.deepEqual(copied, closure, 'the copy set and the closure disagree');
              for (const name of added) {
                assert.ok(copied.includes(name), `${name} (${depth}) was not derived into the fixture root`);
              }
            } finally {
              fs.rmSync(root, { recursive: true, force: true });
              fs.rmSync(dest, { recursive: true, force: true });
            }
            return true;
          }
        ),
        { numRuns: DEPTH_FLOOR }
      );
    }
    assertReachFloor(coverage, DEPTHS, DEPTH_FLOOR, 'new-edge depth');
  });
});

describe('BL-1279 invariant 2: a fixture that cannot load reports no passed check', () => {
  const closure = closureOf(SCRIPTS, ENTRY);

  it('refuses and names the file, for every member of the closure', () => {
    const coverage = {};
    // The domain is the closure itself: finite and enumerable, so each member
    // is removed in turn rather than sampled.
    for (const member of closure) {
      fc.assert(
        fc.property(fc.constant(member), (removed) => {
          coverage[removed] = (coverage[removed] || 0) + 1;
          const root = mkSharedTmpDir('bl1279-prop-broken-');
          try {
            derivedCopySet(SCRIPTS, root);
            fs.rmSync(path.join(root, removed));

            const run = bash(
              `source "${path.join(TEST_LIB, 'bb_fixture_load_guard.sh')}"\n` +
                `assert_bb_closure_present "$SRC" "$FIXTURE" ${ENTRY}\n` +
                `echo "ok   - a check that must never be reached"`,
              { SRC: SCRIPTS, FIXTURE: root }
            );
            const output = `${run.stdout}${run.stderr}`;

            assert.notEqual(run.status, 0, `removing ${removed} still exited zero`);
            assert.ok(output.includes(removed), `the refusal does not name ${removed}:\n${output}`);
            assert.deepEqual(
              output.split('\n').filter((l) => l.startsWith('ok')),
              [],
              `a check was reported as passed with ${removed} missing:\n${output}`
            );
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
          return true;
        }),
        { numRuns: 1 }
      );
    }
    assertReachFloor(coverage, closure, 1, 'closure member removed');
  });
});
