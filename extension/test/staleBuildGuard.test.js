'use strict';

// BL-1972: a unit test run on a stale extension/out/ must stop before any
// test, naming the stale source file and `npm run compile`. The pure core
// (staleSourceFiles) is driven here on fake times via an injected stat fn -
// no real tree, no real clock - so the verdict is about the comparison
// logic, not about what the host happens to have compiled.
//
// Invariant (FIRM): the check stops ONLY when a source under extension/src
// is newer than its compiled file under extension/out, or its compiled file
// is missing. It NEVER stops a run whose out/ was compiled after the
// sources - the fresh cases below must return an empty list.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { staleSourceFiles, parseTsconfigJson, isStrykerSandbox, assertBuildIsFresh } = require('./helpers/staleBuildGuard');
const { mkSharedTmpDir } = require('./helpers/tmpDir');

// A stat fn over a fixed mtime table: paths not in the table throw ENOENT
// (the "compiled missing" case).
function statFromTable(table) {
  return (p) => {
    if (!Object.prototype.hasOwnProperty.call(table, p)) {
      const err = new Error(`ENOENT: no such file or directory, stat '${p}'`);
      err.code = 'ENOENT';
      throw err;
    }
    return { mtimeMs: table[p] };
  };
}

test('BL-1972: a source newer than its compiled file is stale, named', () => {
  const pairs = [
    { source: 'src/a.ts', compiled: 'out/a.js' },
    { source: 'src/b.ts', compiled: 'out/b.js' },
  ];
  const stat = statFromTable({
    'src/a.ts': 2000,
    'out/a.js': 1000, // compiled BEFORE the source: stale
    'src/b.ts': 1000,
    'out/b.js': 2000, // compiled AFTER the source: fresh
  });
  assert.deepEqual(staleSourceFiles(pairs, stat), ['src/a.ts']);
});

test('BL-1972: a missing compiled file is stale, named', () => {
  const pairs = [
    { source: 'src/a.ts', compiled: 'out/a.js' },
    { source: 'src/b.ts', compiled: 'out/b.js' },
  ];
  const stat = statFromTable({
    'src/a.ts': 1000,
    // out/a.js absent: compiled missing -> stale
    'src/b.ts': 1000,
    'out/b.js': 2000,
  });
  assert.deepEqual(staleSourceFiles(pairs, stat), ['src/a.ts']);
});

test('BL-1972: a build compiled after every source is fresh - nothing stale', () => {
  const pairs = [
    { source: 'src/a.ts', compiled: 'out/a.js' },
    { source: 'src/b.ts', compiled: 'out/b.js' },
    { source: 'src/c.ts', compiled: 'out/c.js' },
  ];
  const stat = statFromTable({
    'src/a.ts': 1000,
    'out/a.js': 1000, // same age: fresh (only strictly-newer is stale)
    'src/b.ts': 500,
    'out/b.js': 2000,
    'src/c.ts': 1,
    'out/c.js': 2,
  });
  assert.deepEqual(staleSourceFiles(pairs, stat), []);
});

test('BL-1972: every stale/missing source is named, in pair order', () => {
  const pairs = [
    { source: 'src/a.ts', compiled: 'out/a.js' },
    { source: 'src/b.ts', compiled: 'out/b.js' },
    { source: 'src/c.ts', compiled: 'out/c.js' },
  ];
  const stat = statFromTable({
    'src/a.ts': 3000,
    'out/a.js': 1000, // newer: stale
    'src/b.ts': 1000,
    // out/b.js absent: missing -> stale
    'src/c.ts': 1000,
    'out/c.js': 2000, // fresh
  });
  assert.deepEqual(staleSourceFiles(pairs, stat), ['src/a.ts', 'src/b.ts']);
});

test('BL-1972: isStrykerSandbox recognizes a .stryker-tmp sandbox root and not a normal root', () => {
  assert.equal(isStrykerSandbox('/repo/.stryker-tmp/sandbox-abc123'), true);
  assert.equal(isStrykerSandbox('/repo/extension'), false);
  assert.equal(isStrykerSandbox('/repo/.stryker-tmp'), true);
  // A directory merely named like the marker elsewhere is not a sandbox.
  assert.equal(isStrykerSandbox('/repo/extension/.stryker-tmp-notes'), false);
});

// A fake tree for the mapping seam: one source file under src/, nothing
// else. The tsconfig read is a real readFileSync of the fake root, so the
// fixture writes one there.
function fakeReaddir(root) {
  return (dir) => {
    if (path.resolve(dir) === path.resolve(path.join(root, 'src'))) {
      return [{ name: 'a.ts', isDirectory: () => false }];
    }
    return [];
  };
}

function writeFakeTsconfig(root) {
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'out' } })
  );
}

test('BL-1972: the check skips entirely inside a Stryker sandbox, even when the sandbox mtimes read stale', () => {
  // The sandbox root carries .stryker-tmp in its path; the injected stat
  // table makes every source newer than its compiled file - the exact
  // crash the hardener reproduced (fillSandbox's concurrent copies land
  // sources after their compiled files). The check must NOT throw there.
  const sandboxRoot = path.join('/repo', '.stryker-tmp', 'sandbox-abc123');
  const stat = statFromTable({
    [path.join(sandboxRoot, 'src', 'a.ts')]: 2000,
    [path.join(sandboxRoot, 'out', 'a.js')]: 1000, // source newer: would be stale outside a sandbox
  });
  assert.doesNotThrow(() => assertBuildIsFresh(sandboxRoot, stat, fakeReaddir(sandboxRoot)));
});

test('BL-1972: the check still stops a stale run outside a sandbox', () => {
  // The fake root must be a real directory (the tsconfig readFileSync is
  // real); the src/out contents come from the injected readdir/stat seams.
  const root = mkSharedTmpDir('bl1972-fake-extension-');
  try {
    writeFakeTsconfig(root);
    const stat = statFromTable({
      [path.join(root, 'src', 'a.ts')]: 2000,
      [path.join(root, 'out', 'a.js')]: 1000, // source newer: stale
    });
    assert.throws(
      () => assertBuildIsFresh(root, stat, fakeReaddir(root)),
      (err) => err.message.includes('a.ts') && err.message.includes('npm run compile')
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BL-1972: parseTsconfigJson strips // comments and parses the rest', () => {
  const text = [
    '{',
    '  // a leading-line comment',
    '  "compilerOptions": {',
    '    "outDir": "out", // trailing comment',
    '    "rootDir": "src"',
    '  },',
    '  "include": ["src/**/*"] // another trailing',
    '}',
  ].join('\n');
  const parsed = parseTsconfigJson(text);
  assert.equal(parsed.compilerOptions.outDir, 'out');
  assert.equal(parsed.compilerOptions.rootDir, 'src');
  assert.deepEqual(parsed.include, ['src/**/*']);
});

test('BL-1972: parseTsconfigJson keeps // inside string literals', () => {
  const text = '{ "note": "keep // this", "outDir": "out" }';
  const parsed = parseTsconfigJson(text);
  assert.equal(parsed.note, 'keep // this');
  assert.equal(parsed.outDir, 'out');
});
