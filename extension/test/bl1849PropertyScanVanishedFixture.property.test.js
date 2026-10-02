'use strict';

// BL-1849 declared invariant (backlog/active/BL-1849-*.yaml), coder-authored
// per BL-654; runs only via `npm run test:properties`:
//
//   "A file that vanishes between a property-lane listing of extension/test
//    and its read is skipped; no other read or listing error is swallowed."
//
// Part A drives the REAL findProductionTunnelBindings (bl1061's invariant-2
// scan) through its fsImpl seam over an in-memory tree - no disk, no timing.
// Part B pins the other two census scans (bl932, bl1280) to the shared
// tolerant walk: none of the three lists the directory itself any more.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { assertReachFloor } = require('./helpers/reachFloors');
const { PRODUCTION_TUNNEL_NAMES, findProductionTunnelBindings } = require('./helpers/fixtureTunnelName');

const ROOT = path.join(path.sep, 'scratch', 'test');
const PROD = PRODUCTION_TUNNEL_NAMES[0];
const BINDING = `const env = { SWARMFORGE_NAMED_TUNNEL: '${PROD}' };\n`;
const NON_ENOENT_CODES = ['EACCES', 'EISDIR', 'EPERM', 'EIO'];
const MODES = ['vanish', 'readError', 'listError'];
const RUNS = 300;

function fsError(code, syscall, p) {
  const err = new Error(`${code}: simulated, ${syscall} '${p}'`);
  err.code = code;
  err.path = p;
  return err;
}

function dirent(name, isDir) {
  return { name, isDirectory: () => isDir };
}

// An in-memory fs over `files` ({rel, binds}). `vanished` files are listed but
// their read ENOENTs - removed by their owner right after the listing.
// `readFails` names one surviving file whose read fails with `code`;
// `listFails` makes the listing of `listFails` fail with `code`.
function fakeFs(files, { vanished = new Set(), readFails = null, listFails = null, code = null }) {
  const byPath = new Map(files.map((f) => [path.join(ROOT, f.rel), f]));
  return {
    readdirSync(dir) {
      if (dir === listFails) throw fsError(code, 'scandir', dir);
      const names = new Map();
      for (const full of byPath.keys()) {
        const rel = path.relative(dir, full);
        if (rel.startsWith('..')) continue;
        const [head, ...rest] = rel.split(path.sep);
        names.set(head, rest.length > 0);
      }
      return [...names].map(([name, isDir]) => dirent(name, isDir));
    },
    readFileSync(p) {
      if (p === readFails) throw fsError(code, 'open', p);
      if (vanished.has(p) || !byPath.has(p)) throw fsError('ENOENT', 'open', p);
      return byPath.get(p).binds ? BINDING : "'use strict';\n";
    },
  };
}

const fileArb = fc.record({
  dir: fc.constantFrom('', 'helpers'),
  binds: fc.boolean(),
  vanishes: fc.boolean(),
});

// Generator reach: every case carries one extra file that BINDS the production
// name and is the one that vanishes / fails - constructed, never hoped for -
// so a scan that read the vanished file anyway, or reported a binding it
// never read, is caught on every vanish run.
const caseArb = fc.record({
  mode: fc.constantFrom(...MODES),
  code: fc.constantFrom(...NON_ENOENT_CODES),
  files: fc.array(fileArb, { minLength: 0, maxLength: 6 }),
  targetDir: fc.constantFrom('', 'helpers'),
});

function buildCase({ files, targetDir }) {
  const named = files.map((f, i) => ({ ...f, rel: path.join(f.dir, `f${i}.property.test.js`) }));
  const target = { rel: path.join(targetDir, 'bl868-fixture-1-abc-1.property.test.js'), binds: true, vanishes: true };
  return { all: [...named, target], target };
}

test('property (BL-1849 invariant): a vanished file is skipped; every other read or listing error still fails the scan', () => {
  const coverage = {};
  fc.assert(
    fc.property(caseArb, (c) => {
      coverage[c.mode] = (coverage[c.mode] || 0) + 1;
      const { all, target } = buildCase(c);
      const targetPath = path.join(ROOT, target.rel);

      if (c.mode === 'vanish') {
        const vanished = new Set(all.filter((f) => f.vanishes).map((f) => path.join(ROOT, f.rel)));
        const offenders = findProductionTunnelBindings(ROOT, { fsImpl: fakeFs(all, { vanished }) });
        const expected = all.filter((f) => f.binds && !f.vanishes).map((f) => `${f.rel}: binds ${PROD}`).sort();
        assert.deepEqual(offenders, expected);
        return;
      }

      const opts = c.mode === 'readError'
        ? { readFails: targetPath, code: c.code }
        : { listFails: path.dirname(targetPath), code: c.code };
      assert.throws(
        () => findProductionTunnelBindings(ROOT, { fsImpl: fakeFs(all, opts) }),
        (err) => err.code === c.code && err.message.includes(c.mode === 'readError' ? targetPath : path.dirname(targetPath)),
      );
    }),
    { numRuns: RUNS }
  );
  assertReachFloor(coverage, MODES, 50, 'scan mode');
});

// A listing that ENOENTs is a listing error, not a vanished file: the
// tolerance covers the content read only.
test('property (BL-1849 invariant): an ENOENT on a listing is not swallowed', () => {
  fc.assert(
    fc.property(caseArb, (c) => {
      const { all, target } = buildCase(c);
      const listed = path.dirname(path.join(ROOT, target.rel));
      assert.throws(
        () => findProductionTunnelBindings(ROOT, { fsImpl: fakeFs(all, { listFails: listed, code: 'ENOENT' }) }),
        (err) => err.code === 'ENOENT' && err.message.includes(listed),
      );
    }),
    { numRuns: 50 }
  );
});

// Part B: the census at mint. Each scan of the live extension/test reads
// through the shared tolerant walk and lists nothing itself.
const CENSUS = [
  ['bl1061TunnelFixtureIsolation.property.test.js', /\bfindProductionTunnelBindings\(/],
  ['bl932SharedHeavyTimeoutInvariants.property.test.js', /\bwalkFilesTolerant\(/],
  ['bl1280MkdtempMigrationInvariants.property.test.js', /\bwalkFilesTolerant\(/],
];

test('the three census scans read extension/test only through the shared tolerant walk', () => {
  for (const [file, through] of CENSUS) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(source, through, `${file} no longer scans through the tolerant walk`);
    assert.doesNotMatch(source, /\breaddirSync\(/, `${file} lists a directory itself, outside the tolerant walk`);
  }
});
