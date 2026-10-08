'use strict';

// BL-2065 declared invariants (coder-authored per BL-654 / coder.prompt):
//   1. "Whatever the master checkout's working tree holds, the build the
//      supervisor compiles equals the build of main's committed tree."
//   2. "The build never writes to, stages, restores or deletes a file in
//      the master checkout's working tree."
// Runs ONLY via `npm run test:properties`.
//
// Drives the REAL safe_recompile_cli.bb (-> safe_recompile_lib.bb's
// recompile-extension-from-main!, the function front_desk_supervisor.bb's
// own ensure-current-build! now delegates to) against a fixture git
// checkout standing in for "the master checkout" - never a reimplementation
// of the recompile.
//
// GENERATOR REACH: each draw independently mixes 0-2 edits to EXISTING
// tracked source files (random replacement content) with 0-3 extra
// UNTRACKED source files (random names, random content) - so "clean
// working tree", "edits only", "untracked extras only" and "both at once"
// are all reachable in the same run. A broken implementation that compiles
// the live working tree (rather than main's committed one, the exact
// BL-1911/2026-10-07 shape) fails invariant 1 on any run where the
// generator drew at least one edit or extra; a broken implementation that
// restores/cleans the working tree before compiling (an easy way to get
// invariant 1 "for free") fails invariant 2 the same way.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fc = require('fast-check');
const { mkSharedTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SAFE_RECOMPILE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'safe_recompile_cli.bb');
const TRACKED_FILES = ['a.js', 'b.js'];

const COMPILE_JS = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const srcDir = path.join(__dirname, 'src');",
  "const outDir = path.join(__dirname, 'out');",
  "fs.mkdirSync(outDir, { recursive: true });",
  "const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();",
  "const bundled = files.map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\\n');",
  "fs.writeFileSync(path.join(outDir, 'bundle.js'), bundled);",
  '',
].join('\n');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function buildFixtureRepo() {
  const root = mkSharedTmpDir('sfvc-bl2065-prop-');

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);

  // BL-1390 (this ticket's own constraint): proven isolated before any
  // further, actually-mutating git command - `init`/`config` touch only
  // this fresh root's own .git, never the live checkout.
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const realRoot = fs.realpathSync(root);
  const realCommon = fs.realpathSync(commonDir);
  if (!realCommon.startsWith(realRoot)) {
    throw new Error(`BL-2065 fixture: git-common-dir "${realCommon}" escapes fixture root "${realRoot}"`);
  }

  const extDir = path.join(root, 'extension');
  const srcDir = path.join(extDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { compile: 'node compile.js' } }, null, 2)
  );
  fs.writeFileSync(path.join(extDir, 'compile.js'), COMPILE_JS);
  const committedContent = {};
  for (const name of TRACKED_FILES) {
    const content = `module.exports = '${name}-MAIN';\n`;
    committedContent[name] = content;
    fs.writeFileSync(path.join(srcDir, name), content);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const expectedBundle = TRACKED_FILES.map((name) => committedContent[name]).join('\n');
  return { root, extDir, srcDir, expectedBundle };
}

function resetWorkingTree(root) {
  git(root, ['checkout', '-q', '--', '.']);
  git(root, ['clean', '-q', '-fdx', '--', 'extension']);
}

// Every file under extension/ except the designated compiled-output
// directory itself (out/) - package.json, compile.js, and everything
// (tracked or not) under src/.
function snapshotExtensionTree(extDir) {
  const result = {};
  function walk(dir, relPrefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (relPrefix === '' && entry.name === 'out') {
        continue;
      }
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else {
        result[rel] = fs.readFileSync(abs, 'utf8');
      }
    }
  }
  walk(extDir, '');
  return result;
}

const contaminationArb = fc.record({
  edits: fc.array(fc.tuple(fc.constantFrom(...TRACKED_FILES), fc.string({ minLength: 1, maxLength: 24 })), {
    maxLength: 2,
  }),
  extraContents: fc.array(fc.string({ minLength: 1, maxLength: 24 }), { minLength: 0, maxLength: 3 }),
});

test('BL-2065 invariants 1 and 2: a recompile builds main\'s tree and leaves the working tree untouched', () => {
  const fixture = buildFixtureRepo();
  let totalRuns = 0;
  let contaminatedRuns = 0;

  fc.assert(
    fc.property(contaminationArb, ({ edits, extraContents }) => {
      totalRuns += 1;
      resetWorkingTree(fixture.root);

      for (const [file, suffix] of edits) {
        fs.writeFileSync(path.join(fixture.srcDir, file), `module.exports = ${JSON.stringify(`DIRTY-${suffix}`)};\n`);
      }
      extraContents.forEach((suffix, idx) => {
        fs.writeFileSync(
          path.join(fixture.srcDir, `extra-${idx}.js`),
          `module.exports = ${JSON.stringify(`EXTRA-${suffix}`)};\n`
        );
      });
      if (edits.length > 0 || extraContents.length > 0) {
        contaminatedRuns += 1;
      }

      const before = snapshotExtensionTree(fixture.extDir);

      const out = execFileSync('bb', [SAFE_RECOMPILE_CLI, fixture.root], { encoding: 'utf8' });
      assert.match(out, /^OK /, `safe_recompile_cli.bb must report success, got: ${out}`);

      // Invariant 1: the compiled output is main's committed tree, whatever
      // the working tree held during this run.
      const bundle = fs.readFileSync(path.join(fixture.extDir, 'out', 'bundle.js'), 'utf8');
      assert.equal(
        bundle,
        fixture.expectedBundle,
        "compiled output must equal main's committed tree, never the working tree's"
      );

      // Invariant 2: the recompile touched nothing outside out/ - every
      // tracked-edit and untracked-extra this run created is byte-identical
      // afterward.
      const after = snapshotExtensionTree(fixture.extDir);
      assert.deepEqual(
        after,
        before,
        'the recompile must never write to, stage, restore or delete a file outside extension/out'
      );
    }),
    { numRuns: 12 }
  );

  assert.ok(totalRuns >= 12, `generator reach floor: totalRuns=${totalRuns}`);
  assert.ok(contaminatedRuns >= 6, `generator reach floor: contaminatedRuns=${contaminatedRuns}/${totalRuns}`);
});

// safe-recompile-lib's link-node-modules! is exercised by NEITHER the
// contamination property above nor the acceptance feature - both fixtures
// are deliberately dependency-free ("A fixture project with no node_modules
// of its own (every BL-2065 acceptance scenario) simply compiles without
// it", safe_recompile_lib.bb's own header comment). Every REAL recompile
// (the live checkout, which genuinely has extension/node_modules) exercises
// this path, so it is the one piece of the fix's own mechanism no other
// test in this parcel reaches. Proves the symlink is real and resolvable by
// require() from inside the archived, swapped-in compile - not merely that
// fs.existsSync sees it.
test('BL-2065: a fixture project whose extension has node_modules resolves a real dependency during the recompile', () => {
  const root = mkSharedTmpDir('sfvc-bl2065-nodemodules-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  const commonDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const realRoot = fs.realpathSync(root);
  const realCommon = fs.realpathSync(commonDir);
  assert.ok(
    realCommon.startsWith(realRoot),
    `BL-2065 fixture: git-common-dir "${realCommon}" escapes fixture root "${realRoot}"`
  );

  const extDir = path.join(root, 'extension');
  const srcDir = path.join(extDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const depDir = path.join(extDir, 'node_modules', 'fake-dep');
  fs.mkdirSync(depDir, { recursive: true });
  fs.writeFileSync(path.join(depDir, 'index.js'), "module.exports = 'DEP-RESOLVED';\n");
  // node_modules is deliberately NEVER committed (gitignored in every real
  // extension/ tree) - this matches that, so the test can only pass if
  // link-node-modules! actually symlinks it into the compile's own tmp dir.
  fs.writeFileSync(path.join(extDir, '.gitignore'), 'node_modules/\n');

  fs.writeFileSync(
    path.join(extDir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { compile: 'node compile.js' } }, null, 2)
  );
  fs.writeFileSync(
    path.join(extDir, 'compile.js'),
    [
      "const fs = require('fs');",
      "const path = require('path');",
      "const dep = require('fake-dep');",
      "const outDir = path.join(__dirname, 'out');",
      "fs.mkdirSync(outDir, { recursive: true });",
      "fs.writeFileSync(path.join(outDir, 'bundle.js'), dep);",
      '',
    ].join('\n')
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);

  const out = execFileSync('bb', [SAFE_RECOMPILE_CLI, root], { encoding: 'utf8' });
  assert.match(out, /^OK /, `safe_recompile_cli.bb must report success, got: ${out}`);
  const bundle = fs.readFileSync(path.join(extDir, 'out', 'bundle.js'), 'utf8');
  assert.equal(bundle, 'DEP-RESOLVED', 'the compile must resolve the live checkout\'s own node_modules via the symlink');
});
