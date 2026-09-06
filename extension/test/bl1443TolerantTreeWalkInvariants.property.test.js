'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { walkFilesTolerant } = require('./helpers/tolerantTreeWalk');

// BL-1443 declared invariants (backlog/active/BL-1443-property-walks-tolerate-vanishing-fixtures.yaml):
//   1. "A file that vanishes between a directory listing and its read is
//      skipped by every property-lane tree walk; no other read or listing
//      error is swallowed by that tolerance."
//   2. "The helper reads only: it never writes, moves or deletes a path and
//      never sweeps by prefix (BL-1385/BL-1390)."
// Coder-authored property tests per BL-654; run only via `npm run
// test:properties`. Drive the REAL extension/test/helpers/tolerantTreeWalk.js
// through its fsImpl seam - never a parallel reimplementation of its
// decision logic. Every fixture tree lives under fs.mkdtempSync and is
// never the live repo (BL-1390 posture).

const segmentArb = fc.stringMatching(/^[a-z][a-z0-9_-]{0,6}$/);

// Generator reach: 1-6 files, sometimes flat, sometimes one level of
// subdirectories - so the property covers more than a single canonical
// four-file tree.
function mkTree(fileCount, nested) {
  const root = mkTmpDir('bl1443-prop-');
  const files = [];
  for (let i = 0; i < fileCount; i++) {
    const dir = nested && i % 2 === 0 ? path.join(root, `sub${i}`) : root;
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, `f${i}.js`);
    fs.writeFileSync(full, `// f${i}\n`);
    files.push(full);
  }
  return { root, files };
}

const treeShapeArb = fc.record({
  fileCount: fc.integer({ min: 1, max: 6 }),
  nested: fc.boolean(),
});

const nonEnoentCodeArb = fc.constantFrom('EACCES', 'EISDIR', 'EPERM');

// ── invariant 1 ────────────────────────────────────────────────────────
test('property (invariant 1): a file vanished between listing and read is skipped; any other read failure still fails, naming the path', () => {
  fc.assert(
    fc.property(treeShapeArb, fc.integer({ min: 0, max: 5 }), fc.boolean(), nonEnoentCodeArb, (shape, pickSeed, vanishes, code) => {
      const { root, files } = mkTree(shape.fileCount, shape.nested);
      const targetIndex = pickSeed % files.length;
      const target = files[targetIndex];

      let fsImpl;
      if (vanishes) {
        fsImpl = {
          readdirSync: (...args) => {
            const result = fs.readdirSync(...args);
            if (fs.existsSync(target)) fs.rmSync(target);
            return result;
          },
          readFileSync: (...args) => fs.readFileSync(...args),
        };
      } else {
        fsImpl = {
          readdirSync: (...args) => fs.readdirSync(...args),
          readFileSync: (p, enc) => {
            if (p === target) {
              const err = new Error(`${code}: simulated, open '${p}'`);
              err.code = code;
              err.path = p;
              throw err;
            }
            return fs.readFileSync(p, enc);
          },
        };
      }

      let results = null;
      let thrown = null;
      try {
        results = walkFilesTolerant(root, { extension: '.js', withContent: true, fsImpl });
      } catch (err) {
        thrown = err;
      }

      if (vanishes) {
        assert.equal(thrown, null, `expected the walk to complete for a vanished file, threw: ${thrown && thrown.message}`);
        const resultPaths = results.map((r) => r.path).sort();
        const expected = files.filter((f) => f !== target).sort();
        assert.deepEqual(resultPaths, expected, `expected every file but the vanished one, got: ${resultPaths}`);
      } else {
        assert.ok(thrown, `expected the walk to fail for a ${code} read, but it completed`);
        assert.equal(thrown.code, code, `expected code ${code}, got ${thrown.code}`);
        assert.equal(thrown.path, target, `expected the failure to name ${target}, got path=${thrown.path}`);
      }
    }),
    { numRuns: 30 }
  );
}, 30000);

// ── invariant 2 ────────────────────────────────────────────────────────
function snapshotTree(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(path.relative(root, full), fs.readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return out;
}

test('property (invariant 2): the helper reads only - never writes, moves, deletes, or sweeps by prefix', () => {
  fc.assert(
    fc.property(treeShapeArb, fc.boolean(), (shape, withContent) => {
      const { root, files } = mkTree(shape.fileCount, shape.nested);
      // A sibling directory sharing a name PREFIX with the walked root -
      // "never sweeps by prefix" (BL-1385/BL-1390) means this must survive
      // untouched even though its name starts with the same characters.
      const siblingPrefixed = `${root}-sibling`;
      fs.mkdirSync(siblingPrefixed, { recursive: true });
      fs.writeFileSync(path.join(siblingPrefixed, 'untouched.js'), 'sibling\n');

      const before = snapshotTree(root);
      const siblingBefore = snapshotTree(siblingPrefixed);

      // A read-only fs seam: no write-shaped method exists to call even by
      // accident. If the helper ever tried one, this throws TypeError
      // (not a function), which the property below treats as a failure.
      const readOnlyFs = {
        readdirSync: (...args) => fs.readdirSync(...args),
        readFileSync: (...args) => fs.readFileSync(...args),
      };

      walkFilesTolerant(root, { extension: '.js', withContent, fsImpl: readOnlyFs });

      const after = snapshotTree(root);
      const siblingAfter = snapshotTree(siblingPrefixed);

      assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort(), 'the walked tree changed after a read-only walk');
      assert.deepEqual([...siblingAfter.entries()].sort(), [...siblingBefore.entries()].sort(), 'a prefix-sharing sibling directory was touched - the helper swept by prefix');

      fs.rmSync(siblingPrefixed, { recursive: true, force: true });
    }),
    { numRuns: 20 }
  );
}, 30000);
