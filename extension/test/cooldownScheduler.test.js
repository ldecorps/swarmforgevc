/**
 * BL-082: cooldown-aware wake scheduling — unit tests.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseResetTime,
  isCoolingDown,
  shouldWakeOnExpiry,
  formatCooldownLabel,
  loadCooldownState,
  recordCooldown,
  markCooldownWoken,
  clearCooldown,
  getCooldownUntilMs,
  getCooldownWokenMarker,
} = require('../out/swarm/cooldownScheduler');

const NOW = new Date('2026-07-02T17:00:00Z').getTime(); // 17:00 UTC

function mkTmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-cooldown-'));
  return path.join(dir, 'cooldowns.json');
}

// ── parseResetTime ──────────────────────────────────────────────────────────

test('parseResetTime resolves a bare HH:MM later today to today at that time', () => {
  const result = parseResetTime('tokens return at 18:00', NOW);
  assert.equal(new Date(result).toISOString(), '2026-07-02T18:00:00.000Z');
});

test('parseResetTime resolves a bare HH:MM already past today to tomorrow', () => {
  const result = parseResetTime('reset at 09:00', NOW); // 09:00 < 17:00 "now"
  assert.equal(new Date(result).toISOString(), '2026-07-03T09:00:00.000Z');
});

test('parseResetTime accepts a full ISO timestamp', () => {
  const result = parseResetTime('resume at 2026-07-05T08:30:00Z', NOW);
  assert.equal(new Date(result).toISOString(), '2026-07-05T08:30:00.000Z');
});

test('parseResetTime returns null for missing text', () => {
  assert.equal(parseResetTime(undefined, NOW), null);
  assert.equal(parseResetTime('', NOW), null);
});

test('parseResetTime returns null for unparseable text (no permanent suppression)', () => {
  assert.equal(parseResetTime('tokens will come back eventually', NOW), null);
});

test('parseResetTime accepts a single-digit hour with no leading zero', () => {
  const result = parseResetTime('reset at 9:00', NOW); // 09:00 < 17:00 "now"
  assert.equal(new Date(result).toISOString(), '2026-07-03T09:00:00.000Z');
});

test('parseResetTime accepts the top of the 2[0-3] hour range', () => {
  const result = parseResetTime('reset at 23:00', NOW);
  assert.equal(new Date(result).toISOString(), '2026-07-02T23:00:00.000Z');
});

test('parseResetTime rolls a bare HH:MM to tomorrow when it exactly equals now', () => {
  const result = parseResetTime('reset at 17:00', NOW); // NOW is exactly 17:00:00
  assert.equal(new Date(result).toISOString(), '2026-07-03T17:00:00.000Z');
});

test('parseResetTime accepts an ISO timestamp with a numeric UTC offset', () => {
  const result = parseResetTime('resume at 2026-07-05T10:30:00+02:00', NOW);
  assert.equal(new Date(result).toISOString(), '2026-07-05T08:30:00.000Z');
});

test('parseResetTime treats a zoneless ISO timestamp as UTC', () => {
  const result = parseResetTime('resume at 2026-07-05T08:30:00', NOW);
  assert.equal(new Date(result).toISOString(), '2026-07-05T08:30:00.000Z');
});

test('parseResetTime accepts an ISO timestamp with seconds omitted', () => {
  // Seconds are optional in the ISO match; without this case a mutant that
  // makes the (:\d{2})? group required still passes by falling through to
  // the bare-HH:MM parser and landing on a plausible-looking (wrong) date.
  const result = parseResetTime('resume at 2026-07-05T08:30Z', NOW);
  assert.equal(new Date(result).toISOString(), '2026-07-05T08:30:00.000Z');
});

test('parseResetTime preserves full millisecond precision from the fractional-seconds group', () => {
  // Distinguishes the real (\.\d+)? group from a single-digit or
  // non-digit-only mutant, both of which would truncate or drop 123ms.
  const result = parseResetTime('resume at 2026-07-05T08:30:00.123Z', NOW);
  assert.equal(new Date(result).toISOString(), '2026-07-05T08:30:00.123Z');
});

// ── isCoolingDown ────────────────────────────────────────────────────────────

test('isCoolingDown true while now is before untilMs', () => {
  assert.equal(isCoolingDown(NOW + 1000, NOW), true);
});

test('isCoolingDown false once now reaches untilMs', () => {
  assert.equal(isCoolingDown(NOW, NOW), false);
});

test('isCoolingDown false when no cooldown recorded', () => {
  assert.equal(isCoolingDown(null, NOW), false);
  assert.equal(isCoolingDown(undefined, NOW), false);
});

test('isCoolingDown false for a numeric-looking string even though it would compare as greater', () => {
  assert.equal(isCoolingDown(String(NOW + 1000), NOW), false);
});

// ── shouldWakeOnExpiry ───────────────────────────────────────────────────────

test('shouldWakeOnExpiry false before expiry', () => {
  assert.equal(shouldWakeOnExpiry(NOW + 1000, NOW, null), false);
});

test('shouldWakeOnExpiry true exactly at expiry when not yet woken', () => {
  assert.equal(shouldWakeOnExpiry(NOW, NOW, null), true);
});

test('shouldWakeOnExpiry true after expiry when not yet woken', () => {
  assert.equal(shouldWakeOnExpiry(NOW - 1000, NOW, null), true);
});

test('shouldWakeOnExpiry false once already woken for this untilMs', () => {
  assert.equal(shouldWakeOnExpiry(NOW, NOW, NOW), false);
});

test('shouldWakeOnExpiry true again for a new, later cooldown window', () => {
  const laterUntil = NOW + 3600_000;
  assert.equal(shouldWakeOnExpiry(laterUntil, laterUntil, NOW), true);
});

test('shouldWakeOnExpiry false when no cooldown recorded', () => {
  assert.equal(shouldWakeOnExpiry(null, NOW, null), false);
});

test('shouldWakeOnExpiry false for a numeric-looking string even though it would compare as expired', () => {
  assert.equal(shouldWakeOnExpiry(String(NOW - 1000), NOW, null), false);
});

// ── formatCooldownLabel ──────────────────────────────────────────────────────

test('formatCooldownLabel renders HH:MM in UTC', () => {
  assert.equal(formatCooldownLabel(new Date('2026-07-02T18:00:00Z').getTime()), 'cooldown until 18:00');
});

test('formatCooldownLabel zero-pads single-digit hour and minute', () => {
  assert.equal(formatCooldownLabel(new Date('2026-07-02T05:03:00Z').getTime()), 'cooldown until 05:03');
});

// ── persistence (restart resilience) ────────────────────────────────────────

test('loadCooldownState returns empty object when file absent', () => {
  const file = mkTmpFile();
  assert.deepEqual(loadCooldownState(file), {});
});

test('loadCooldownState returns empty object for corrupt file', () => {
  const file = mkTmpFile();
  fs.writeFileSync(file, 'not-json', 'utf-8');
  assert.deepEqual(loadCooldownState(file), {});
});

test('loadCooldownState returns empty object when the file holds valid JSON that is not an object', () => {
  const file = mkTmpFile();
  fs.writeFileSync(file, '42', 'utf-8');
  assert.deepEqual(loadCooldownState(file), {});
});

test('loadCooldownState returns empty object when the file holds JSON null', () => {
  const file = mkTmpFile();
  fs.writeFileSync(file, 'null', 'utf-8');
  assert.deepEqual(loadCooldownState(file), {});
});

test('recordCooldown then getCooldownUntilMs round-trips', () => {
  const file = mkTmpFile();
  recordCooldown(file, 'coder', NOW + 5000);
  assert.equal(getCooldownUntilMs(file, 'coder'), NOW + 5000);
});

test('recordCooldown persists across a fresh read (restart resilience)', () => {
  const file = mkTmpFile();
  recordCooldown(file, 'coder', NOW + 5000);
  const reloaded = loadCooldownState(file);
  assert.equal(reloaded.coder.untilMs, NOW + 5000);
});

test('markCooldownWoken sets wokenForUntilMs only for the recorded role', () => {
  const file = mkTmpFile();
  recordCooldown(file, 'coder', NOW + 5000);
  markCooldownWoken(file, 'coder', NOW + 5000);
  assert.equal(getCooldownWokenMarker(file, 'coder'), NOW + 5000);
});

test('markCooldownWoken is a no-op when the role has no recorded cooldown', () => {
  const file = mkTmpFile();
  markCooldownWoken(file, 'coder', NOW + 5000);
  assert.equal(getCooldownUntilMs(file, 'coder'), null);
  assert.equal(getCooldownWokenMarker(file, 'coder'), null);
});

test('getCooldownWokenMarker returns null without throwing for a role with no entry', () => {
  const file = mkTmpFile();
  assert.equal(getCooldownWokenMarker(file, 'cleaner'), null);
});

test('clearCooldown removes the role entry', () => {
  const file = mkTmpFile();
  recordCooldown(file, 'coder', NOW + 5000);
  clearCooldown(file, 'coder');
  assert.equal(getCooldownUntilMs(file, 'coder'), null);
});

test('getCooldownUntilMs returns null for a role with no entry', () => {
  const file = mkTmpFile();
  assert.equal(getCooldownUntilMs(file, 'cleaner'), null);
});

test('recordCooldown round-trips a non-ASCII role name through utf-8 persistence', () => {
  const file = mkTmpFile();
  recordCooldown(file, 'héllo-wörld', NOW + 5000);
  const reloaded = loadCooldownState(file);
  assert.equal(reloaded['héllo-wörld'].untilMs, NOW + 5000);
});

test('recordCooldown does not disturb other roles', () => {
  const file = mkTmpFile();
  recordCooldown(file, 'coder', NOW + 5000);
  recordCooldown(file, 'cleaner', NOW + 9000);
  assert.equal(getCooldownUntilMs(file, 'coder'), NOW + 5000);
  assert.equal(getCooldownUntilMs(file, 'cleaner'), NOW + 9000);
});
