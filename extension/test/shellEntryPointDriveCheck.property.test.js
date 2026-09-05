'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  assessShellEntryPointDrive,
  testInvokesEntryPoint,
  extractNamedEntryPoints,
} = require('../out/tools/shellEntryPointDriveCheck');

// BL-747 invariants:
// 1. Check is a no-op unless both shell tests touched AND entry-points named.
// 2. When both hold, every named entry-point must be invoked (not merely sourced).

const basenameArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,12}\.sh$/)
  .filter((s) => !s.includes('test'));

test('property: source-only helper never counts as invoking the entry-point', () => {
  fc.assert(
    fc.property(basenameArb, (entry) => {
      const text = `source "$ROOT/swarmforge/scripts/lib/helper.sh"\necho ${entry}\n`;
      assert.equal(testInvokesEntryPoint(text, entry), false);
    }),
    { numRuns: 40 }
  );
});

test('property: bash …/name always counts as an invocation', () => {
  fc.assert(
    fc.property(basenameArb, (entry) => {
      const text = `bash "$ROOT/swarmforge/scripts/${entry}" --flag\n`;
      assert.equal(testInvokesEntryPoint(text, entry), true);
    }),
    { numRuns: 40 }
  );
});

test('property: no-op when either shell-tests or entry-points set is empty', () => {
  fc.assert(
    fc.property(fc.boolean(), fc.boolean(), basenameArb, (hasTests, hasEntry, entry) => {
      const ticketYaml = hasEntry ? `description: verifies ${entry}\n` : 'description: none\n';
      const shellTests = hasTests
        ? [
            {
              path: 'swarmforge/scripts/test/test_x.sh',
              text: 'source ./lib/h.sh\n',
            },
          ]
        : [];
      const result = assessShellEntryPointDrive({ ticketYaml, shellTests });
      assert.equal(result.checked, true);
      if (!hasTests || extractNamedEntryPoints(ticketYaml).length === 0) {
        assert.equal(result.miss, undefined);
      }
    }),
    { numRuns: 40 }
  );
});
