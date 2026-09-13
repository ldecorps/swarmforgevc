const assert = require('node:assert/strict');
const fc = require('fast-check');
const { COMMIT_APPROVAL_WRITES_IMPORT, EXPEDITE_COMMIT_CALL } = require('../../specs/pipeline/steps/bl582WiringPatterns');

// BL-1482 (coder.prompt's Invariants section - first authorship of a
// DECLARED invariant's property test rests with the coder): "No step of
// BL-582's handler asserts an exact source line of production code: every
// source-read assertion names the symbol and the module it protects and
// tolerates unrelated tokens on the same line, so an unrelated edit to
// that line cannot turn the scenario red."
//
// Exercises the ACTUAL regexes the step handler runs (imported from
// bl582WiringPatterns.js, not a duplicate) against generated synthetic
// source snippets, for both wiring guards this ticket touched:
//   1. the import line (symbol + module, tolerant of what else is imported
//      alongside it and how it is spaced/ordered)
//   2. the Expedite commit call (symbol + call shape, tolerant of
//      reformatting/comments between its args and its message)
//
// Runs ONLY via `npm run test:properties`; excluded from unit/coverage/
// mutation, per the standard property-test separation.
//
// Non-vacuity, checked by hand before landing: reverting
// bl582WiringPatterns.js's EXPEDITE_COMMIT_CALL to the old
// `/return commitApprovalWrites\(targetPath, backlogId, `Expedite/` line
// literal fails this property's "tolerates reformatting" case (and BL-582's
// own acceptance run) on the current production shape; restoring the fix
// passes both again.

const identifierArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,20}$/);
const wsArb = fc.constantFrom(' ', '\n  ', '\n    ', '\n\t');

function buildImportLine(names, spacing) {
  return `import {${spacing}${names.join(`,${spacing}`)}${spacing}} from '../util/commitIntegrityRunner';`;
}

test('property: the import guard matches whenever commitApprovalWrites is imported from the right module, whatever else rides the brace list', () => {
  fc.assert(
    fc.property(
      fc.array(identifierArb.filter((n) => n !== 'commitApprovalWrites'), { maxLength: 4 }),
      fc.nat({ max: 3 }), // where to insert commitApprovalWrites among the other names
      wsArb,
      (otherNames, insertAt, spacing) => {
        const names = [...otherNames];
        names.splice(Math.min(insertAt, names.length), 0, 'commitApprovalWrites');
        const line = buildImportLine(names, spacing);
        assert.match(line, COMMIT_APPROVAL_WRITES_IMPORT, `expected a match for: ${line}`);
      }
    ),
    { numRuns: 200 }
  );
});

test('property: the import guard never matches when commitApprovalWrites is absent, renamed, or from a different module', () => {
  fc.assert(
    fc.property(
      fc.array(identifierArb.filter((n) => n !== 'commitApprovalWrites'), { minLength: 1, maxLength: 4 }),
      wsArb,
      fc.constantFrom('../util/otherModule', '../util/commitIntegrityRunnerV2', './commitIntegrityRunner'),
      (names, spacing, wrongModule) => {
        // Case A: right module, but the symbol itself is missing.
        const missingSymbol = buildImportLine(names, spacing);
        assert.doesNotMatch(missingSymbol, COMMIT_APPROVAL_WRITES_IMPORT, `must not match: ${missingSymbol}`);

        // Case B: symbol present but imported from a different module.
        const wrongModuleLine = buildImportLine([...names, 'commitApprovalWrites'], spacing).replace(
          "'../util/commitIntegrityRunner'",
          `'${wrongModule}'`
        );
        assert.doesNotMatch(wrongModuleLine, COMMIT_APPROVAL_WRITES_IMPORT, `must not match: ${wrongModuleLine}`);
      }
    ),
    { numRuns: 200 }
  );
});

function buildExpediteCall(commentLines, backlogIdArgName, messageSuffix) {
  const comments = commentLines.map((c) => `    // ${c}\n`).join('');
  return [
    'export async function commitExpediteWrites(targetPath, backlogId, sourcePath) {',
    '  const result = await commitApprovalWrites(',
    '    targetPath,',
    `    ${backlogIdArgName},`,
    comments + '    humanDecisionCommitMessage(`Expedite ' + messageSuffix + '`),',
    '    sourcePath ? [sourcePath] : []',
    '  );',
    '  return result.success;',
    '}',
  ].join('\n');
}

test('property: the Expedite commit-call guard matches across reformatting/comments and rejects a broken call shape', () => {
  fc.assert(
    fc.property(
      fc.array(fc.stringMatching(/^[a-zA-Z0-9 :.'-]{0,40}$/), { maxLength: 3 }),
      fc.stringMatching(/^[a-zA-Z0-9 {}$:+-]{0,40}$/),
      (commentLines, messageSuffix) => {
        const good = buildExpediteCall(commentLines, 'backlogId', messageSuffix);
        assert.match(good, EXPEDITE_COMMIT_CALL, `expected a match for: ${good}`);

        // Args reordered - no longer targetPath then backlogId first.
        const reordered = buildExpediteCall(commentLines, 'backlogId', messageSuffix).replace(
          '    targetPath,\n    backlogId,',
          '    backlogId,\n    targetPath,'
        );
        assert.doesNotMatch(reordered, EXPEDITE_COMMIT_CALL, `must not match reordered args: ${reordered}`);

        // Message no longer names Expedite.
        const renamed = good.replace('Expedite ' + messageSuffix, 'Amend ' + messageSuffix);
        assert.doesNotMatch(renamed, EXPEDITE_COMMIT_CALL, `must not match a non-Expedite message: ${renamed}`);
      }
    ),
    { numRuns: 200 }
  );
});
