'use strict';

// BL-693 declared invariants, coder's first-pass property authorship
// (BL-654):
//
// 1. "No line whose content is markdown structure rather than prose ...
//    is ever reported as a duplicate, however many times it repeats."
// 2. "A substantial paragraph repeated within one docs file turns the
//    guard red inside the parcel that introduces it" - i.e. findDuplicateLines
//    reliably catches every substantial-line repeat, over generated
//    content, not just the fixed examples in the acceptance scenarios.
//
// Both drive the REAL pure scanner (findDuplicateLines) the standing guard
// (docsDuplicateParagraphGuard.test.js) and the acceptance handler both
// use - no re-implementation.
//
// Non-vacuity (staged-first restore, run 2026-09-18, recorded in the
// parcel commit): both properties were run against a deliberately broken
// findDuplicateLines that always returned [] (the exact failure mode
// BL-692 shipped undetected) - property 2 failed immediately, naming the
// generated duplicate it should have caught; property 1 could not tell
// the difference (an always-empty result vacuously satisfies "never
// reports a structural line"), which is exactly why property 2 exists as
// its own check rather than relying on property 1 alone. Restored
// byte-for-byte, both properties hold.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { DEFAULT_THRESHOLD, findDuplicateLines } = require('./helpers/docsDuplicateParagraphGuard');

// Realistic structural-markdown-line generators, each bounded well under
// the threshold - matching real markdown, never an adversarial 300-char
// "horizontal rule" no real document would contain.
const structuralLineArb = fc.oneof(
  fc.constantFrom('---', '***', '___', '----'),
  fc.tuple(fc.integer({ min: 1, max: 6 }), fc.string({ minLength: 0, maxLength: 40 })).map(([n, s]) => `${'#'.repeat(n)} ${s}`),
  fc.constantFrom('```', '````', '~~~', '```js', '```bash'),
  fc.integer({ min: 1, max: 8 }).map((n) => `|${' --- |'.repeat(n)}`),
  fc.constantFrom('- ', '* ', '+ ', '1. ', '2. '),
  fc.string({ minLength: 0, maxLength: 60 }).map((s) => `> ${s}`),
  fc.constantFrom('┌───┐', '│   │', '└───┘', '├───┤', '─────')
);

test('property (invariant 1): a realistic structural line, however many times repeated, is never reported', () => {
  fc.assert(
    fc.property(structuralLineArb, fc.integer({ min: 2, max: 50 }), (line, times) => {
      fc.pre(line.trim().length <= DEFAULT_THRESHOLD);
      const content = Array(times).fill(line).join('\n');
      const result = findDuplicateLines(content);
      assert.deepEqual(result, [], `structural line "${line}" repeated ${times}x was reported: ${JSON.stringify(result)}`);
    }),
    { numRuns: 200 }
  );
});

// Printable ASCII, never structural-shaped by construction (letters,
// digits, spaces) - long enough after padding to exceed the threshold.
const substantialLineArb = fc
  .string({ minLength: DEFAULT_THRESHOLD + 1, maxLength: DEFAULT_THRESHOLD + 300, unit: 'grapheme-ascii' })
  .filter((s) => s.trim().length > DEFAULT_THRESHOLD);

test('property (invariant 2): a substantial line repeated N times is always caught, with the exact count and every line number', () => {
  fc.assert(
    fc.property(substantialLineArb, fc.integer({ min: 2, max: 12 }), (line, times) => {
      const content = Array(times).fill(line).join('\n');
      const result = findDuplicateLines(content);
      assert.equal(result.length, 1, `expected exactly one duplicate group for "${line.slice(0, 20)}...", got: ${JSON.stringify(result)}`);
      assert.equal(result[0].count, times);
      assert.equal(result[0].lines.length, times);
      assert.deepEqual(result[0].lines, Array.from({ length: times }, (_, i) => i + 1));
    }),
    { numRuns: 200 }
  );
});
