const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  extractUsageLimitLine,
  rateLimitCooldownFilePath,
  recordRateLimitCooldownIfPresent,
} = require('../out/swarm/rateLimitCooldownDetector');
const { loadCooldownState } = require('../out/swarm/cooldownScheduler');

const NOW = new Date('2026-07-10T17:00:00Z').getTime(); // 17:00 UTC

function mkTmpTargetPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-rate-limit-cooldown-'));
}

// ── extractUsageLimitLine (pure) ─────────────────────────────────────────

test('extractUsageLimitLine returns null when no usage/rate-limit line is present', () => {
  assert.equal(extractUsageLimitLine('just some agent output\nworking on the task'), null);
  assert.equal(extractUsageLimitLine(null), null);
  assert.equal(extractUsageLimitLine(undefined), null);
});

test('extractUsageLimitLine finds a line naming a usage limit', () => {
  const text = 'thinking...\nClaude usage limit reached. Resets at 18:00.\n';
  assert.equal(extractUsageLimitLine(text), 'Claude usage limit reached. Resets at 18:00.');
});

test('extractUsageLimitLine finds a line naming a rate limit (case-insensitive)', () => {
  const text = 'RATE-LIMIT hit, resume at 2026-07-10T20:00:00Z';
  assert.equal(extractUsageLimitLine(text), text);
});

test('extractUsageLimitLine returns the LAST such line when several appear', () => {
  const text =
    'usage limit reached, resets at 09:00\n' +
    'lots of output in between\n' +
    'usage limit reached, resets at 18:00';
  assert.equal(extractUsageLimitLine(text), 'usage limit reached, resets at 18:00');
});

// ── recordRateLimitCooldownIfPresent (BL-209 detect-and-record-01/ordinary-output-noop-04) ─

test('BL-209 detect-and-record-01: records a cooldown until the parsed reset time', () => {
  const targetPath = mkTmpTargetPath();
  recordRateLimitCooldownIfPresent(targetPath, 'coder', 'usage limit reached, resets at 18:00', NOW);
  const state = loadCooldownState(rateLimitCooldownFilePath(targetPath));
  assert.equal(state.coder.untilMs, new Date('2026-07-10T18:00:00Z').getTime());
});

test('BL-209 ordinary-output-noop-04: ordinary pane output does not record a cooldown', () => {
  const targetPath = mkTmpTargetPath();
  recordRateLimitCooldownIfPresent(targetPath, 'coder', 'implementing the feature\nrunning tests', NOW);
  const state = loadCooldownState(rateLimitCooldownFilePath(targetPath));
  assert.equal(state.coder, undefined);
});

test('a usage-limit line with no parseable reset time is a no-op (no permanent suppression)', () => {
  const targetPath = mkTmpTargetPath();
  recordRateLimitCooldownIfPresent(targetPath, 'coder', 'usage limit reached, try again later', NOW);
  const state = loadCooldownState(rateLimitCooldownFilePath(targetPath));
  assert.equal(state.coder, undefined);
});

test('records cooldowns for different roles independently', () => {
  const targetPath = mkTmpTargetPath();
  recordRateLimitCooldownIfPresent(targetPath, 'coder', 'usage limit reached, resets at 18:00', NOW);
  recordRateLimitCooldownIfPresent(targetPath, 'cleaner', 'usage limit reached, resets at 20:00', NOW);
  const state = loadCooldownState(rateLimitCooldownFilePath(targetPath));
  assert.equal(state.coder.untilMs, new Date('2026-07-10T18:00:00Z').getTime());
  assert.equal(state.cleaner.untilMs, new Date('2026-07-10T20:00:00Z').getTime());
});
