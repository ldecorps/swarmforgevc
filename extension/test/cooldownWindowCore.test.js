const assert = require('node:assert/strict');
const {
  parseLocalTime,
  parseCooldownConfig,
  isWithinWindow,
  currentWindowStartMs,
  nextWindowCloseMs,
  decideCooldownWindow,
} = require('../out/tools/cooldownWindowCore');

const NOT_PAUSED = { active: false };

// Fixed baseline calendar date so "local" times resolve deterministically
// regardless of which day the suite runs on - 2026-07-24 is a Friday.
function localMs(monthDay, hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(2026, 6, monthDay, hour, minute, 0, 0).getTime();
}

const ENABLED_CONF = 'config cooldown_window_enabled true\nconfig cooldown_start_local 19:00\nconfig cooldown_end_local 07:00\n';

// ── parseLocalTime ──────────────────────────────────────────────────────

test('BL-617: parseLocalTime accepts a valid HH:MM', () => {
  assert.deepEqual(parseLocalTime('19:00'), { hour: 19, minute: 0 });
  assert.deepEqual(parseLocalTime('07:05'), { hour: 7, minute: 5 });
});

test('BL-617: parseLocalTime rejects an out-of-range or malformed value', () => {
  assert.equal(parseLocalTime('25:99'), null);
  assert.equal(parseLocalTime('19:60'), null);
  assert.equal(parseLocalTime('not-a-time'), null);
  assert.equal(parseLocalTime(undefined), null);
});

// ── parseCooldownConfig ─────────────────────────────────────────────────

test('BL-617: disabled or absent config parses to enabled:false, never malformed', () => {
  assert.deepEqual(parseCooldownConfig(''), {
    config: { enabled: false, startLocal: { hour: 19, minute: 0 }, endLocal: { hour: 7, minute: 0 } },
    malformed: false,
  });
  assert.deepEqual(parseCooldownConfig('config cooldown_window_enabled false\n'), {
    config: { enabled: false, startLocal: { hour: 19, minute: 0 }, endLocal: { hour: 7, minute: 0 } },
    malformed: false,
  });
});

test('BL-617: enabled with explicit times parses both', () => {
  const parsed = parseCooldownConfig(ENABLED_CONF);
  assert.equal(parsed.malformed, false);
  assert.deepEqual(parsed.config, { enabled: true, startLocal: { hour: 19, minute: 0 }, endLocal: { hour: 7, minute: 0 } });
});

test('BL-617: enabled with no times configured defaults to 19:00/07:00', () => {
  const parsed = parseCooldownConfig('config cooldown_window_enabled true\n');
  assert.equal(parsed.malformed, false);
  assert.deepEqual(parsed.config.startLocal, { hour: 19, minute: 0 });
  assert.deepEqual(parsed.config.endLocal, { hour: 7, minute: 0 });
});

test('BL-617: a malformed start time disables the window and reports malformed', () => {
  const parsed = parseCooldownConfig('config cooldown_window_enabled true\nconfig cooldown_start_local 25:99\n');
  assert.equal(parsed.config, null);
  assert.equal(parsed.malformed, true);
  assert.match(parsed.warning, /malformed/i);
});

// ── isWithinWindow / currentWindowStartMs / nextWindowCloseMs ──────────

test('BL-617: isWithinWindow handles a window spanning midnight', () => {
  const start = { hour: 19, minute: 0 };
  const end = { hour: 7, minute: 0 };
  assert.equal(isWithinWindow(18 * 60 + 59, start, end), false);
  assert.equal(isWithinWindow(19 * 60, start, end), true);
  assert.equal(isWithinWindow(23 * 60 + 30, start, end), true);
  assert.equal(isWithinWindow(0 * 60 + 45, start, end), true);
  assert.equal(isWithinWindow(6 * 60 + 59, start, end), true);
  assert.equal(isWithinWindow(7 * 60, start, end), false);
  assert.equal(isWithinWindow(12 * 60, start, end), false);
});

test('BL-617: currentWindowStartMs resolves the early-morning half to the preceding day', () => {
  const start = { hour: 19, minute: 0 };
  assert.equal(currentWindowStartMs(localMs(24, '19:03'), start), localMs(24, '19:00'));
  assert.equal(currentWindowStartMs(localMs(25, '00:45'), start), localMs(24, '19:00'));
});

test('BL-617: nextWindowCloseMs finds the next boundary regardless of which half of the window', () => {
  const end = { hour: 7, minute: 0 };
  assert.equal(nextWindowCloseMs(localMs(24, '19:03'), end), localMs(25, '07:00'));
  assert.equal(nextWindowCloseMs(localMs(24, '23:30'), end), localMs(25, '07:00'));
  assert.equal(nextWindowCloseMs(localMs(25, '00:45'), end), localMs(25, '07:00'));
});

// ── decideCooldownWindow: BL-617 window-decision-table-02 (Scenario Outline) ─

test('BL-617: window-decision-table-02 across the configured window', () => {
  const config = parseCooldownConfig(ENABLED_CONF).config;
  // day 24 evening -> day 25 morning is one continuous window instance.
  const cases = [
    [24, '18:59', 'none'],
    [24, '19:00', 'apply-pause'],
    [24, '23:30', 'apply-pause'],
    [25, '00:45', 'apply-pause'],
    [25, '06:59', 'apply-pause'],
    [25, '07:00', 'none'],
    [25, '12:00', 'none'],
  ];
  for (const [day, localTime, expected] of cases) {
    const nowMs = localMs(day, localTime);
    const decision = decideCooldownWindow({ nowMs, config, pauseState: NOT_PAUSED, lastHandledWindowStartMs: undefined });
    assert.equal(decision.action, expected, `expected ${localTime} -> ${expected}, got ${decision.action}`);
  }
});

test('BL-617 window-open-applies-timed-pause-01: applies a pause until the next window close', () => {
  const config = parseCooldownConfig(ENABLED_CONF).config;
  const nowMs = localMs(24, '19:03');
  const decision = decideCooldownWindow({ nowMs, config, pauseState: NOT_PAUSED, lastHandledWindowStartMs: undefined });
  assert.equal(decision.action, 'apply-pause');
  assert.equal(decision.untilMs, localMs(25, '07:00'));
  assert.equal(decision.windowStartMs, localMs(24, '19:00'));
});

test('BL-617 human-pause-at-window-open-untouched-04: an active pause is never overridden', () => {
  const config = parseCooldownConfig(ENABLED_CONF).config;
  const nowMs = localMs(24, '19:03');
  const pauseState = { active: true, untilMs: localMs(24, '20:00') };
  const decision = decideCooldownWindow({ nowMs, config, pauseState, lastHandledWindowStartMs: undefined });
  assert.deepEqual(decision, { action: 'none' });
});

test('BL-617 cooldown-applies-after-human-pause-expires-05: applies once the human pause has cleared inside an unconsumed window', () => {
  const config = parseCooldownConfig(ENABLED_CONF).config;
  const nowMs = localMs(24, '20:05');
  const decision = decideCooldownWindow({ nowMs, config, pauseState: NOT_PAUSED, lastHandledWindowStartMs: undefined });
  assert.equal(decision.action, 'apply-pause');
  assert.equal(decision.untilMs, localMs(25, '07:00'));
});

test('BL-617 human-resume-now-during-window-wins-06: once consumed, the window never re-applies, even past midnight', () => {
  const config = parseCooldownConfig(ENABLED_CONF).config;
  const consumedAt = localMs(24, '19:00');
  const afterResume = decideCooldownWindow({
    nowMs: localMs(24, '21:05'),
    config,
    pauseState: NOT_PAUSED,
    lastHandledWindowStartMs: consumedAt,
  });
  assert.deepEqual(afterResume, { action: 'none' });
  const stillNight = decideCooldownWindow({
    nowMs: localMs(25, '03:00'),
    config,
    pauseState: NOT_PAUSED,
    lastHandledWindowStartMs: consumedAt,
  });
  assert.deepEqual(stillNight, { action: 'none' });
});

test('BL-617 disabled-config-no-pause-08: a disabled window never pauses', () => {
  const config = parseCooldownConfig('config cooldown_window_enabled false\n').config;
  const decision = decideCooldownWindow({
    nowMs: localMs(24, '19:30'),
    config,
    pauseState: NOT_PAUSED,
    lastHandledWindowStartMs: undefined,
  });
  assert.deepEqual(decision, { action: 'none' });
});

test('BL-617 malformed-config-no-pause-loud-09: malformed config (config=null) never pauses', () => {
  const { config, malformed, warning } = parseCooldownConfig(
    'config cooldown_window_enabled true\nconfig cooldown_start_local 25:99\n'
  );
  assert.equal(malformed, true);
  assert.ok(warning);
  const decision = decideCooldownWindow({
    nowMs: localMs(24, '19:30'),
    config,
    pauseState: NOT_PAUSED,
    lastHandledWindowStartMs: undefined,
  });
  assert.deepEqual(decision, { action: 'none' });
});

test('BL-617 default-times-apply-10: enabled with no times configured still applies at 19:00', () => {
  const config = parseCooldownConfig('config cooldown_window_enabled true\n').config;
  const decision = decideCooldownWindow({
    nowMs: localMs(24, '19:03'),
    config,
    pauseState: NOT_PAUSED,
    lastHandledWindowStartMs: undefined,
  });
  assert.equal(decision.action, 'apply-pause');
  assert.equal(decision.untilMs, localMs(25, '07:00'));
});
