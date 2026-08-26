const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  extractDocCitations,
  findUnresolvedCitations,
} = require('../../specs/pipeline/steps/lib/constitutionDocCitations');

// BL-945 (coder.prompt's Invariants section - first authorship rests with
// the coder): a coder-authored property test for this ticket's declared
// invariant - "The check reports only what an agent could not read. A
// citation is a defect solely because the path does not resolve on main -
// never because of how it is spelled, cased, or punctuated. A check that
// flags a resolvable path is worse than no check". Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs); excluded from
// unit/coverage/mutation.
//
// Non-vacuity, checked by hand before landing: forcing
// findUnresolvedCitations to always return [] fails the "always reported"
// property below on its first generated case; forcing it to always report
// every scanned citation fails the "never reported" property just as
// reliably. Restoring the real implementation passes both again.

const segmentArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
const extArb = fc.constantFrom('md', 'MD', 'Md', 'prompt', 'txt');
const pathSegmentsArb = fc.array(segmentArb, { minLength: 1, maxLength: 4 });
const docsPathArb = fc
  .tuple(pathSegmentsArb, segmentArb, extArb)
  .map(([dirs, name, ext]) => `docs/${dirs.join('/')}/${name}.${ext}`);

// Realistic non-docs backtick tokens the real constitution articles cite
// (scripts, config, API calls, bare cross-article filenames) - none of
// these are "document paths" and must never be extracted as citations,
// however they are spelled or punctuated.
const decoyArb = fc.oneof(
  segmentArb.map((s) => `${s}.sh`),
  segmentArb.map((s) => `${s}.conf`),
  segmentArb.map((s) => `${s}.json`),
  segmentArb.map((s) => `swarmforge/scripts/${s}.sh`),
  fc.constant('fs.mkdtempSync'),
  fc.constant('05_amendments.md'),
  fc.constant('PIPELINE.md'),
  fc.constant('https://example.com/spec')
);

test('property: any docs/ path is extracted verbatim, regardless of nesting depth or extension casing', () => {
  fc.assert(
    fc.property(docsPathArb, (p) => {
      const text = `Authority: \`${p}\`.\n`;
      assert.deepEqual(extractDocCitations(text), [p]);
    }),
    { numRuns: 200 }
  );
});

test('property: a non-docs backtick token is never extracted as a citation, however it is spelled or punctuated', () => {
  fc.assert(
    fc.property(decoyArb, (token) => {
      const text = `See \`${token}\` for details.\n`;
      assert.deepEqual(extractDocCitations(text), []);
    }),
    { numRuns: 200 }
  );
});

test('property: a docs/ citation that genuinely resolves on disk is never reported', () => {
  const root = mkTmpDir('sfvc-bl945-prop-');
  fc.assert(
    fc.property(pathSegmentsArb, segmentArb, extArb, (dirs, name, ext) => {
      const rel = `docs/${dirs.join('/')}/${name}.${ext}`;
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'content\n');
      fs.writeFileSync(path.join(root, 'article.md'), `Authority: \`${rel}\`.\n`);

      const unresolved = findUnresolvedCitations(root, root);
      assert.deepEqual(unresolved, [], `expected ${rel} to resolve, got: ${JSON.stringify(unresolved)}`);
    }),
    { numRuns: 50 }
  );
});

test('property: a docs/ citation to a path that does not exist is always reported', () => {
  const root = mkTmpDir('sfvc-bl945-prop-');
  fc.assert(
    fc.property(pathSegmentsArb, segmentArb, extArb, (dirs, name, ext) => {
      const rel = `docs/${dirs.join('/')}/${name}.${ext}`;
      // Deliberately never created on disk.
      fs.writeFileSync(path.join(root, 'article.md'), `Authority: \`${rel}\`.\n`);

      const unresolved = findUnresolvedCitations(root, root);
      assert.deepEqual(unresolved, [{ file: 'article.md', citation: rel }]);
    }),
    { numRuns: 50 }
  );
});
