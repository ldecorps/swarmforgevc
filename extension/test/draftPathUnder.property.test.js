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
test('removeDraftIfPresent property: idempotent cleanup regardless of whether the draft still exists (BL-1537 invariant 2)', () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !s.includes('\0') && !s.includes('/')),
      (existedBefore, name) => {
        const dir = mkTmpDir('draft-path-under-property-');
        const draftPath = path.join(dir, name);
        if (existedBefore) {
          fs.writeFileSync(draftPath, 'type: note\n');
        }
        assert.doesNotThrow(() => removeDraftIfPresent(draftPath));
        assert.equal(fs.existsSync(draftPath), false);
      }
    )
  );
});
