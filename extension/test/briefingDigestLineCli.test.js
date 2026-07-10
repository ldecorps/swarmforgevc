const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sinceLastBriefingMs, formatMergedBlockedDigest } = require('../out/tools/briefing-digest-line');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-digest-test-'));
}

// ── sinceLastBriefingMs ─────────────────────────────────────────────────

test('with two or more briefings, the cutoff is the second-most-recent one (today\'s own file is excluded)', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, '2026-07-08.md'), 'old\n');
  fs.writeFileSync(path.join(dir, '2026-07-09.md'), 'yesterday\n');
  fs.writeFileSync(path.join(dir, '2026-07-10.md'), 'today, about to be sent\n');

  const cutoffMs = sinceLastBriefingMs(dir, Date.parse('2026-07-10T20:00:00Z'));

  assert.equal(cutoffMs, Date.parse('2026-07-09T00:00:00Z'));
});

test('with fewer than two briefings, falls back to a 24h window, not a crash', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, '2026-07-10.md'), 'only today\n');
  const nowMs = Date.parse('2026-07-10T20:00:00Z');

  assert.equal(sinceLastBriefingMs(dir, nowMs), nowMs - 24 * 60 * 60 * 1000);
});

test('an absent briefings directory falls back to a 24h window, not a crash', () => {
  const nowMs = Date.parse('2026-07-10T20:00:00Z');
  assert.equal(sinceLastBriefingMs(path.join(mkTmp(), 'nonexistent'), nowMs), nowMs - 24 * 60 * 60 * 1000);
});

// ── formatMergedBlockedDigest ────────────────────────────────────────────
// graceful-missing-data-05

test('formats merged and blocked lines, with deep links when a builder returns one', () => {
  const merged = [{ ticketId: 'BL-1', closeDateIso: '2026-07-09T10:00:00Z' }];
  const blocked = [{ ticketId: 'BL-2', role: 'coder', openMs: 13 * 60 * 60 * 1000 }];

  const text = formatMergedBlockedDigest(merged, blocked, (id) => `https://example.io/#ticket=${id}`);

  assert.match(text, /Merged since last briefing: BL-1 \(https:\/\/example\.io\/#ticket=BL-1\)/);
  assert.match(text, /Blocked\/stalled: BL-2 \(https:\/\/example\.io\/#ticket=BL-2\) \(coder, open 13h/);
});

test('omits the link parens when no deep link is available', () => {
  const merged = [{ ticketId: 'BL-1', closeDateIso: '2026-07-09T10:00:00Z' }];
  const text = formatMergedBlockedDigest(merged, [], () => null);
  assert.match(text, /Merged since last briefing: BL-1$/m);
});

test('an empty merged list shows an explicit "none" note, not a blank line', () => {
  const text = formatMergedBlockedDigest([], [], () => null);
  assert.match(text, /Merged since last briefing: none\./);
});

test('an empty blocked list shows an explicit "none" note, not a blank line', () => {
  const text = formatMergedBlockedDigest([], [], () => null);
  assert.match(text, /Blocked\/stalled: none\./);
});

// ── end-to-end: the compiled CLI's own real output ────────────────────────

test('the compiled CLI runs against the real repo and prints both lines', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'briefing-digest-line.js');
  const output = execFileSync('node', [cliPath], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' });
  assert.match(output, /^Merged since last briefing: /);
  assert.match(output, /Blocked\/stalled: /);
});
