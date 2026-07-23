const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  conciergeTickRequestPath,
  requestConciergeTick,
  consumeConciergeTickRequest,
} = require('../out/concierge/conciergeTickRequest');

test('requestConciergeTick + consumeConciergeTickRequest: wake file is written then consumed once', () => {
  const targetPath = mkTmpDir('sfvc-concierge-tick-request-');
  requestConciergeTick(targetPath, 42);
  const file = conciergeTickRequestPath(targetPath);
  assert.equal(fs.readFileSync(file, 'utf8'), '42');
  assert.equal(consumeConciergeTickRequest(targetPath), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(consumeConciergeTickRequest(targetPath), false);
});
