const assert = require('node:assert/strict');
const { scanUnexpected } = require('./onboarderResidualAllowlist');

// BL-684 scenario onboarder-rename-01 (and BL-694): scans every git-tracked
// file for the retired word. Allowlist logic lives in onboarderResidualAllowlist.js.

test('no live git-tracked file still says "facilitator" outside the dated record and the named naming-decision citations', () => {
  const unexpected = scanUnexpected();
  assert.deepEqual(unexpected, [], `unexpected residual "facilitator" mentions (BL-684): ${JSON.stringify(unexpected)}`);
});
