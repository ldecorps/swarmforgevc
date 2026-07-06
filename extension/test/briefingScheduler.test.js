const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  utcDayKey,
  isBriefingDue,
  loadBriefingScheduleState,
  recordBriefingFired,
  startBriefingScheduler,
} = require('../out/notify/briefingScheduler');

function mkTmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-briefing-schedule-'));
  return path.join(dir, 'schedule.json');
}

const BRIEFING_HOUR = 8; // 08:00 UTC
const DAY1_BEFORE_HOUR = new Date('2026-07-02T07:00:00Z').getTime();
const DAY1_AFTER_HOUR = new Date('2026-07-02T09:00:00Z').getTime();
const DAY2_AFTER_HOUR = new Date('2026-07-03T09:00:00Z').getTime();
const DAY4_AFTER_HOUR = new Date('2026-07-05T09:00:00Z').getTime(); // two days skipped

test('utcDayKey formats a UTC calendar day as YYYY-MM-DD', () => {
  assert.equal(utcDayKey(DAY1_AFTER_HOUR), '2026-07-02');
});

// BL-099 briefing-01: fires once per day.
test('isBriefingDue is false before the scheduled hour has passed today', () => {
  assert.equal(isBriefingDue(DAY1_BEFORE_HOUR, BRIEFING_HOUR, null), false);
});

test('isBriefingDue is true after the scheduled hour when never fired before', () => {
  assert.equal(isBriefingDue(DAY1_AFTER_HOUR, BRIEFING_HOUR, null), true);
});

test('isBriefingDue is false again the same day once already fired', () => {
  assert.equal(isBriefingDue(DAY1_AFTER_HOUR, BRIEFING_HOUR, utcDayKey(DAY1_AFTER_HOUR)), false);
});

test('isBriefingDue is true again the next day even if fired the previous day', () => {
  assert.equal(isBriefingDue(DAY2_AFTER_HOUR, BRIEFING_HOUR, utcDayKey(DAY1_AFTER_HOUR)), true);
});

// BL-099 briefing-05: downtime across multiple scheduled times produces one
// catch-up, not a burst - isBriefingDue only ever answers for "now", so a
// gap of several missed days still yields exactly one true, for today.
test('isBriefingDue collapses a multi-day gap into a single due signal for today', () => {
  assert.equal(isBriefingDue(DAY4_AFTER_HOUR, BRIEFING_HOUR, utcDayKey(DAY1_AFTER_HOUR)), true);
  // and immediately false again once recorded fired for that day - no burst.
  assert.equal(isBriefingDue(DAY4_AFTER_HOUR, BRIEFING_HOUR, utcDayKey(DAY4_AFTER_HOUR)), false);
});

test('loadBriefingScheduleState defaults to null when the file does not exist', () => {
  const filePath = mkTmpFile();
  assert.deepEqual(loadBriefingScheduleState(filePath), { lastFiredDayKey: null });
});

test('loadBriefingScheduleState tolerates a corrupt file', () => {
  const filePath = mkTmpFile();
  fs.writeFileSync(filePath, 'not json', 'utf-8');
  assert.deepEqual(loadBriefingScheduleState(filePath), { lastFiredDayKey: null });
});

test('recordBriefingFired persists the day key durably across reads', () => {
  const filePath = mkTmpFile();
  recordBriefingFired(filePath, '2026-07-02');
  assert.deepEqual(loadBriefingScheduleState(filePath), { lastFiredDayKey: '2026-07-02' });
});

// startBriefingScheduler: injected tick/clock, no real timers.
test('startBriefingScheduler fires onBriefingDue exactly once per tick when due, and records it', () => {
  const filePath = mkTmpFile();
  let ticks = [];
  let due = 0;
  const scheduleTick = (fn, ms) => {
    ticks.push({ fn, ms });
    return ticks.length;
  };
  const clearTick = () => {};

  const dispose = startBriefingScheduler(
    { briefingHourUtc: BRIEFING_HOUR, scheduleStatePath: filePath },
    { getNowMs: () => DAY1_AFTER_HOUR, onBriefingDue: () => due++ },
    60000,
    scheduleTick,
    clearTick
  );

  assert.equal(ticks.length, 1);
  ticks[0].fn(); // simulate the interval firing
  assert.equal(due, 1);
  assert.deepEqual(loadBriefingScheduleState(filePath), { lastFiredDayKey: utcDayKey(DAY1_AFTER_HOUR) });

  // a second tick the same day does not fire again.
  ticks[0].fn();
  assert.equal(due, 1);

  dispose();
});

test('startBriefingScheduler disposer calls clearTick with the scheduled handle', () => {
  const filePath = mkTmpFile();
  let cleared = null;
  const dispose = startBriefingScheduler(
    { briefingHourUtc: BRIEFING_HOUR, scheduleStatePath: filePath },
    { getNowMs: () => DAY1_BEFORE_HOUR, onBriefingDue: () => {} },
    60000,
    () => 'handle-42',
    (h) => {
      cleared = h;
    }
  );
  dispose();
  assert.equal(cleared, 'handle-42');
});
