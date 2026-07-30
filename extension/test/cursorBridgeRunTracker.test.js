const assert = require('node:assert/strict');
const {
  beginActiveRun,
  endActiveRun,
  recordActiveRunProgress,
  readActiveRun,
  isActiveRunInFlight,
  formatActiveRunUpdate,
  formatIdleUpdateMessage,
} = require('../out/bridge/cursorBridgeRunTracker');

test('active run tracker records progress and formats update', () => {
  beginActiveRun('fix notifier', 1_000);
  recordActiveRunProgress('🔧 edit');
  recordActiveRunProgress('✓ shell');
  const run = readActiveRun();
  assert.ok(run);
  const text = formatActiveRunUpdate(run, 61_000);
  assert.match(text, /Agent run in progress/);
  assert.match(text, /fix notifier/);
  assert.match(text, /1m 0s/);
  assert.match(text, /🔧 edit/);
  endActiveRun();
  assert.equal(isActiveRunInFlight(), false);
  assert.match(formatIdleUpdateMessage(), /No Cursor agent run/);
});
