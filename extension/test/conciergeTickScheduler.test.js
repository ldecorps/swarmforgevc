const assert = require('node:assert/strict');
const { ConciergeTickScheduler } = require('../out/concierge/conciergeTickScheduler');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('ConciergeTickScheduler.runNow: single-flight coalesces concurrent callers', async () => {
  let running = 0;
  let maxRunning = 0;
  const scheduler = new ConciergeTickScheduler(async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await sleep(30);
    running -= 1;
  });
  await Promise.all([scheduler.runNow(), scheduler.runNow(), scheduler.runNow()]);
  assert.equal(maxRunning, 1);
});

test('ConciergeTickScheduler.scheduleDebounced: coalesces burst calls into one tick', async () => {
  let runs = 0;
  const scheduler = new ConciergeTickScheduler(async () => {
    runs += 1;
  });
  scheduler.scheduleDebounced(20);
  scheduler.scheduleDebounced(20);
  scheduler.scheduleDebounced(20);
  await sleep(60);
  scheduler.clearDebounceForTest();
  assert.equal(runs, 1);
});
