'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  findCrossFileDuplication,
  MIN_DUPLICATION_BLOCK_LINES,
} = require('../out/tools/crossFileDuplicationCheck');

// BL-737 invariants (backlog/active/BL-737-...yaml):
// 1. Cross-file duplication is judged only on the provided touched-file set.
// 2. Identical normalized text in more than two files refuses; two-file does not.
// 3. (inert land) encoded with the gate's shared property tests.

const lineArb = fc.stringMatching(/^[a-z][a-z0-9 ]{0,20}$/);

const blockArb = fc.array(lineArb, { minLength: MIN_DUPLICATION_BLOCK_LINES, maxLength: MIN_DUPLICATION_BLOCK_LINES });

test('property: identical block in N>2 files always refuses; N<=2 never refuses', () => {
  fc.assert(
    fc.property(blockArb, fc.integer({ min: 0, max: 3 }), (lines, overTwo) => {
      const block = lines.join('\n');
      const n = 2 + overTwo; // 2..5
      const files = [];
      for (let i = 0; i < n; i += 1) {
        files.push({ path: `f${i}.sh`, text: `header\n${block}\ntrailer-${i}\n` });
      }
      const result = findCrossFileDuplication(files);
      assert.equal(result.checked, true);
      assert.equal(result.filesScanned, n);
      if (n > 2) {
        assert.ok(result.duplication, `expected refusal for n=${n}`);
        assert.equal(result.duplication.paths.length, n);
      } else {
        assert.equal(result.duplication, undefined, `expected no refusal for n=${n}`);
      }
    }),
    { numRuns: 50 }
  );
});

test('property: an untouched third file with the same block never affects a two-file touched set', () => {
  fc.assert(
    fc.property(blockArb, (lines) => {
      const block = lines.join('\n');
      const touched = [
        { path: 'a.sh', text: block },
        { path: 'b.sh', text: block },
      ];
      // Caller never passes untouched-c.sh — invariant 1.
      const result = findCrossFileDuplication(touched);
      assert.equal(result.duplication, undefined);
    }),
    { numRuns: 40 }
  );
});

test('property: trailing-whitespace normalization makes padded clones match', () => {
  fc.assert(
    fc.property(blockArb, (lines) => {
      const plain = lines.join('\n');
      const padded = lines.map((l) => `${l}  `).join('\n');
      const result = findCrossFileDuplication([
        { path: 'a.sh', text: plain },
        { path: 'b.sh', text: padded },
        { path: 'c.sh', text: plain },
      ]);
      assert.ok(result.duplication);
    }),
    { numRuns: 40 }
  );
});
