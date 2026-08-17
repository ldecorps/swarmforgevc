const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { getLetsTalkUiBundleManifest } = require('../out/bridge/letsTalkUiBundle');

// BL-829 invariant 2's bridge-side half: "Only pages the resolved bundle
// manifest names are ever loaded" starts with the manifest parser itself
// never handing the shell a partially-validated page list. letsTalkUiBundle.ts
// enforces the SAME whole-or-nothing posture BL-825 already established for
// schemaVersion/bundleVersion/minShellVersion/payload (BL-654 invariant 2),
// extended to `pages` — a malformed page entry rejects the entire document,
// never just that one entry. extension/test/letsTalkUiBundle.test.js pins
// this at a handful of named examples; this file fuzzes arbitrary manifests
// and arbitrary malformed page shapes to check the parser generalizes past
// those examples, mirroring the Kotlin-side
// UiBundleResolverParseWholeOrNothingPropertyTest.kt's own extension for the
// same field on the Android parser.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

function mkOperatorDir() {
  const root = mkTmpDir('sfvc-lt-ui-bundle-pages-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function manifestPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'lets-talk-ui-bundle.json');
}

function writeManifest(root, doc) {
  fs.writeFileSync(manifestPath(root), JSON.stringify(doc));
}

// .map() reconstructs a plain Object.prototype object from fc.record's
// fields - fc.record can hand back a null-prototype instance, which would
// make a strict deep-equal against a JSON.parse'd (always plain-object)
// result fail on prototype alone, never on the fields under test.
const validPageArb = fc
  .record({
    id: fc.string({ minLength: 1 }),
    title: fc.string({ minLength: 1 }),
    entryPath: fc.string({ minLength: 1 }),
    order: fc.integer(),
  })
  .map((p) => ({ id: p.id, title: p.title, entryPath: p.entryPath, order: p.order }));

const baseManifestArb = fc.record({
  schemaVersion: fc.integer(),
  bundleVersion: fc.integer({ min: 1 }), // never 0, so it's distinguishable from DEFAULT_MANIFEST
  minShellVersion: fc.integer(),
  payload: fc.string({ minLength: 1 }), // never '', so it's distinguishable from DEFAULT_MANIFEST
});

// A value that is never itself a valid string field (so corrupting a field
// with one of these can never accidentally still be valid - the same
// exclusion the Kotlin property test's wrongTypedForStringField applies).
const wrongTypedStringArb = fc.oneof(
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string())
);

// A value that is never itself a finite number (so corrupting `order` with
// one of these can never accidentally still be valid).
const wrongTypedOrderArb = fc.oneof(
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity)
);

test('a well-formed pages list round-trips exactly, in order, with the rest of the manifest intact', () => {
  fc.assert(
    fc.property(baseManifestArb, fc.array(validPageArb, { maxLength: 6 }), (base, pages) => {
      const root = mkOperatorDir();
      writeManifest(root, { ...base, pages });

      const manifest = getLetsTalkUiBundleManifest(root, {});

      assert.equal(manifest.payload, base.payload);
      assert.equal(manifest.bundleVersion, base.bundleVersion);
      assert.deepEqual(manifest.pages, pages);
    }),
    { numRuns: 100 }
  );
});

test('a manifest with no pages field at all still parses, backward compatible with pre-BL-829 documents', () => {
  fc.assert(
    fc.property(baseManifestArb, (base) => {
      const root = mkOperatorDir();
      writeManifest(root, base);

      const manifest = getLetsTalkUiBundleManifest(root, {});

      assert.equal(manifest.payload, base.payload);
      assert.deepEqual(manifest.pages, []);
    }),
    { numRuns: 40 }
  );
});

test('a page entry missing or wrong-typing exactly one field rejects the WHOLE manifest, never just that page', () => {
  fc.assert(
    fc.property(
      baseManifestArb,
      fc.array(validPageArb, { minLength: 0, maxLength: 3 }),
      fc.array(validPageArb, { minLength: 0, maxLength: 3 }),
      fc.constantFrom('id', 'title', 'entryPath', 'order'),
      fc.boolean(), // true: drop the field; false: wrong-type it
      wrongTypedStringArb,
      wrongTypedOrderArb,
      (base, before, after, corruptedKey, dropField, wrongString, wrongOrder) => {
        const goodPage = { id: 'ok-page', title: 'Ok', entryPath: 'ok', order: 0 };
        const badPage = { ...goodPage };
        if (dropField) {
          delete badPage[corruptedKey];
        } else if (corruptedKey === 'order') {
          badPage.order = wrongOrder;
        } else {
          badPage[corruptedKey] = wrongString;
        }

        const root = mkOperatorDir();
        writeManifest(root, { ...base, pages: [...before, badPage, ...after] });

        const manifest = getLetsTalkUiBundleManifest(root, {});

        assert.equal(manifest.payload, '', JSON.stringify({ base, before, badPage, after }));
        assert.deepEqual(manifest.pages, []);
        assert.equal(manifest.bundleVersion, 0);
      }
    ),
    { numRuns: 150 }
  );
});

test('pages as a non-array value rejects the whole manifest', () => {
  const nonArrayArb = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.record({ nested: fc.integer() })
  );
  fc.assert(
    fc.property(baseManifestArb, nonArrayArb, (base, pages) => {
      const root = mkOperatorDir();
      writeManifest(root, { ...base, pages });

      const manifest = getLetsTalkUiBundleManifest(root, {});

      assert.equal(manifest.payload, '');
      assert.deepEqual(manifest.pages, []);
    }),
    { numRuns: 40 }
  );
});

// Non-vacuity companion: a permissive parser that FILTERS OUT bad page
// entries instead of rejecting the whole document (an easy mistake - each
// page "looks independent") would fail the property above. Demonstrate that
// against the same malformed-manifest shape the real parser is proven to
// reject, then confirm the real parser does not share the flaw.
test('a naive per-page-filtering parser would fail the whole-or-nothing property', () => {
  const root = mkOperatorDir();
  const base = { schemaVersion: 1, bundleVersion: 9, minShellVersion: 0, payload: '<html></html>' };
  const goodPage = { id: 'live', title: 'Live', entryPath: 'live', order: 0 };
  const badPage = { id: 'broken', entryPath: 'broken', order: 1 }; // missing `title`
  writeManifest(root, { ...base, pages: [goodPage, badPage] });

  function naiveParse(doc) {
    const isValidPage = (p) =>
      typeof p.id === 'string' && p.id.length > 0 &&
      typeof p.title === 'string' && p.title.length > 0 &&
      typeof p.entryPath === 'string' && p.entryPath.length > 0 &&
      typeof p.order === 'number' && Number.isFinite(p.order);
    return { ...doc, pages: Array.isArray(doc.pages) ? doc.pages.filter(isValidPage) : [] };
  }

  const rawDoc = JSON.parse(fs.readFileSync(manifestPath(root), 'utf8'));
  const naiveResult = naiveParse(rawDoc);
  // The naive parser keeps the good page and the real payload - exactly the
  // "partial page list" BL-829 invariant 2 forbids.
  assert.equal(naiveResult.payload, base.payload);
  assert.deepEqual(naiveResult.pages, [goodPage]);

  const realResult = getLetsTalkUiBundleManifest(root, {});
  assert.equal(realResult.payload, '');
  assert.deepEqual(realResult.pages, []);
});
