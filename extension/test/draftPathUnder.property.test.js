const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { draftPathUnder, removeDraftIfPresent } = require('../out/swarm/draftPathUnder');

// BL-1537 declared invariant 1: a production sender's draft always lives
// under the project root the send resolves - never under TMPDIR, /tmp, or
// os.tmpdir() - so BL-1518-a's fail-closed root guard refuses only ever a
// fixture escape, never a live send. Generator-reach: TMPDIR is drawn from
// a disjoint namespace from the fixture root on every iteration (a real
// live-bug shape would leak through TMPDIR into the returned path), and the
// two draws per run prove the directory is the SAME regardless of which
// TMPDIR happened to be set - the property a `path.join(os.tmpdir(), ...)`
// regression would violate on its very first counterexample.
test('draftPathUnder property: the draft directory depends only on root, never on TMPDIR (BL-1537 invariant 1)', () => {
  const savedTmpdir = process.env.TMPDIR;
  try {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !s.includes('\0') && !s.includes('/')),
        fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !s.includes('\0') && !s.includes('/')),
        fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !s.includes('\0') && !s.includes('/')),
        fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !s.includes('\0') && !s.includes('/')),
        (rootSegment, prefix, tmpdirASegment, tmpdirBSegment) => {
          const root = path.join('/bl1537-fixture-root', rootSegment);
          const expectedDraftDir = path.join(root, 'tmp');

          process.env.TMPDIR = path.join('/bl1537-fc-tmpdir-a', tmpdirASegment);
          const draftPathA = draftPathUnder(root, prefix);

          process.env.TMPDIR = path.join('/bl1537-fc-tmpdir-b', tmpdirBSegment);
          const draftPathB = draftPathUnder(root, prefix);

          assert.equal(path.dirname(draftPathA), expectedDraftDir);
          assert.equal(path.dirname(draftPathB), expectedDraftDir);
          assert.ok(!draftPathA.startsWith(path.join('/bl1537-fc-tmpdir-a', tmpdirASegment)));
          assert.ok(!draftPathB.startsWith(path.join('/bl1537-fc-tmpdir-b', tmpdirBSegment)));
        }
      )
    );
  } finally {
    if (savedTmpdir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = savedTmpdir;
    }
  }
});

// BL-1537 declared invariant 2: a draft is removed by its sender on every
// exit path - queued, refused, signalled - and swarm_handoff.bb itself
// deletes the draft on the queued/delivered path (its own `(fs/delete
// draft)`), so a sender's cleanup must be idempotent rather than assume the
// file is still there. Generator-reach: `existedBefore` is drawn so roughly
// half the runs exercise "the CLI already removed it" and half exercise
// "the CLI never got that far" - both real exit shapes, not a corner case
// hoped to come up by chance.
//
// BL-1550: this invariant quantifies only over names that resolve to a
// STRICT CHILD of the fixture directory. "." and ".." are excluded by
// construction - a filter that checks the resolved path's dirname is the
// fixture dir, never by hoping the seed avoids them - because
// path.join(dir, '.') is dir itself, not a draft name, and the directory
// case (BL-1550's own example, scenario 02) is a different shape this
// property does not own.
test('removeDraftIfPresent property: idempotent cleanup regardless of whether the draft still exists (BL-1537 invariant 2)', () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc
        .string({ minLength: 1, maxLength: 24 })
        .filter((s) => !s.includes('\0') && !s.includes('/'))
        .filter((s) => path.dirname(path.join('/bl1550-fixture-dir', s)) === '/bl1550-fixture-dir'),
      (existedBefore, name) => {
        const dir = mkTmpDir('draft-path-under-property-');
        const draftPath = path.join(dir, name);
        assert.equal(path.dirname(draftPath), dir, `expected ${name} to resolve to a strict child of ${dir}`);
        if (existedBefore) {
          fs.writeFileSync(draftPath, 'type: note\n');
        }
        assert.doesNotThrow(() => removeDraftIfPresent(draftPath));
        assert.equal(fs.existsSync(draftPath), false);
      }
    )
  );
});

// BL-1550 declared invariant 1: removeDraftIfPresent removes only a regular
// file at the exact path it is given - never a directory, never recursing
// into one, never throwing whether the path is a regular file, absent, or
// a directory. Generator-reach: `kind` is drawn from all four states the
// helper's contract distinguishes (file / absent / empty directory /
// non-empty directory), each paired with a fresh generated name, so every
// run exercises a real state the three production callers can hand the
// helper on their own exit paths - not just the one shape a hand-picked
// example would reach.
test('removeDraftIfPresent property: removes only a regular file, never a directory, never throws (BL-1550 invariant 1)', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('file', 'absent', 'emptyDir', 'dirWithFile'),
      fc
        .string({ minLength: 1, maxLength: 24 })
        .filter((s) => !s.includes('\0') && !s.includes('/'))
        .filter((s) => path.dirname(path.join('/bl1550-fixture-dir', s)) === '/bl1550-fixture-dir'),
      (kind, name) => {
        const dir = mkTmpDir('draft-path-under-invariant1-property-');
        const draftPath = path.join(dir, name);
        let innerFile = null;
        if (kind === 'file') {
          fs.writeFileSync(draftPath, 'type: note\n');
        } else if (kind === 'emptyDir') {
          fs.mkdirSync(draftPath);
        } else if (kind === 'dirWithFile') {
          fs.mkdirSync(draftPath);
          innerFile = path.join(draftPath, 'inner');
          fs.writeFileSync(innerFile, 'x');
        }

        assert.doesNotThrow(() => removeDraftIfPresent(draftPath));

        if (kind === 'file' || kind === 'absent') {
          assert.equal(fs.existsSync(draftPath), false, `expected ${draftPath} to be gone for kind=${kind}`);
        } else {
          assert.ok(fs.existsSync(draftPath), `expected ${draftPath} to still exist for kind=${kind}`);
          assert.ok(fs.statSync(draftPath).isDirectory(), `expected ${draftPath} to still be a directory for kind=${kind}`);
          if (kind === 'dirWithFile') {
            assert.ok(fs.existsSync(innerFile), `expected ${innerFile} to still exist`);
          }
        }
      }
    )
  );
});
