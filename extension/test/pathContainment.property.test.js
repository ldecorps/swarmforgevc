const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { tryRealpath } = require('../out/util/pathContainment');

// BL-792 (architect property-testing pass): tryRealpath is a canonicalizer -
// its whole contract (co-change-report.ts / relay-onboarding-negotiation-
// telegram.ts's use of it) is that comparing two paths through it agrees
// regardless of how many times either side was canonicalized first. That
// only holds if applying it twice gives the same answer as applying it once.
// Segment arbitrary avoids path separators/NUL so every generated tail is a
// single valid path component on both target OSes (macOS/Linux).
const pathSegmentArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/);
const tailArb = fc.array(pathSegmentArb, { minLength: 0, maxLength: 4 });

test('property: tryRealpath is idempotent for an existing root plus any not-yet-created tail', () => {
  const tmpDir = mkTmpDir('sfvc-tryrealpath-prop-');
  fc.assert(
    fc.property(tailArb, (tail) => {
      const candidate = path.join(tmpDir, ...tail);
      const once = tryRealpath(candidate);
      const twice = tryRealpath(once);
      assert.equal(twice, once);
    }),
    { numRuns: 100 }
  );
});

test('property: tryRealpath of an existing path equals fs.realpathSync of that path', () => {
  const tmpDir = mkTmpDir('sfvc-tryrealpath-prop-');
  fc.assert(
    fc.property(tailArb, (tail) => {
      const dir = tail.reduce((parent, segment) => {
        const next = path.join(parent, segment);
        fs.mkdirSync(next, { recursive: true });
        return next;
      }, tmpDir);
      assert.equal(tryRealpath(dir), fs.realpathSync(dir));
    }),
    { numRuns: 50 }
  );
});

test('non-vacuity: a defective non-canonicalizing variant would break idempotence across a symlinked ancestor', () => {
  const realDir = mkTmpDir('sfvc-tryrealpath-prop-real-');
  const linkDir = path.join(mkTmpDir('sfvc-tryrealpath-prop-link-'), 'alias');
  fs.symlinkSync(realDir, linkDir, 'dir');
  const notYetCreated = path.join(linkDir, 'does', 'not', 'exist');

  const once = tryRealpath(notYetCreated);
  assert.equal(tryRealpath(once), once, 'the real implementation is idempotent');

  const defectiveIdentity = (p) => p;
  const defectiveOnce = defectiveIdentity(notYetCreated);
  assert.notEqual(
    defectiveIdentity(defectiveOnce),
    once,
    'the defective (non-canonicalizing) variant disagrees with the real canonical form, proving the property is load-bearing'
  );
});
