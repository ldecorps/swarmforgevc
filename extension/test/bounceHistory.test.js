const assert = require('node:assert/strict');
const { formatBounceHistoryEntry, parseBounceHistoryEntries, mergeBounceHistoryEntry } = require('../out/quality/bounceHistory');

// BL-608: the pure render/merge core for a ticket's own `bounce_history:`
// record. No filesystem, no clock - callers own reading/writing the file.

function entry(overrides = {}) {
  return {
    at: '2026-07-23',
    by: 'QA',
    blamed: 'coder',
    failureClass: 'behavior',
    commit: '1f7987dd4a',
    evidence: 'backlog/evidence/BL-606-qa-bounce-20260723.md',
    ...overrides,
  };
}

function ticketYaml(extra = '') {
  return (
    'id: BL-606\n' +
    'title: "Some ticket"\n' +
    'status: active\n' +
    'assigned_to: coder\n' +
    extra +
    'description: |\n' +
    '  Multi-line block scalar that must survive untouched.\n' +
    '  Second line.\n'
  );
}

// ── formatBounceHistoryEntry / parseBounceHistoryEntries round-trip ──────

test('formatBounceHistoryEntry renders a single-line flow mapping', () => {
  assert.equal(
    formatBounceHistoryEntry(entry()),
    '  - { at: 2026-07-23, by: QA, blamed: coder, class: behavior, commit: 1f7987dd4a, evidence: backlog/evidence/BL-606-qa-bounce-20260723.md }'
  );
});

test('parseBounceHistoryEntries reads back entries formatBounceHistoryEntry wrote', () => {
  const text = 'bounce_count: 1\nbounce_history:\n' + formatBounceHistoryEntry(entry()) + '\n';
  assert.deepEqual(parseBounceHistoryEntries(text), [entry()]);
});

// ── absent bounce_history block (bounce-history-on-ticket-01) ───────────

test('mergeBounceHistoryEntry appends a first entry when no block exists yet', () => {
  const before = ticketYaml();
  const result = mergeBounceHistoryEntry(before, entry());
  assert.equal(result.updated, true);
  assert.equal(result.reason, 'appended');
  assert.match(result.text, /bounce_count: 1\n/);
  assert.equal(parseBounceHistoryEntries(result.text).length, 1);
  // the untouched block-scalar body survives verbatim
  assert.match(result.text, /Multi-line block scalar that must survive untouched\.\n  Second line\.\n/);
});

// ── existing block appended to (bounce-history-on-ticket-03) ────────────

test('mergeBounceHistoryEntry appends a distinct entry after an existing one, oldest first', () => {
  const first = mergeBounceHistoryEntry(ticketYaml(), entry());
  const second = mergeBounceHistoryEntry(first.text, entry({ at: '2026-07-24', commit: 'deadbeef00' }));
  assert.equal(second.updated, true);
  assert.equal(second.reason, 'appended');
  const entries = parseBounceHistoryEntries(second.text);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].at, '2026-07-23');
  assert.equal(entries[1].at, '2026-07-24');
  assert.match(second.text, /bounce_count: 2\n/);
});

// ── duplicate natural key (bounce-history-on-ticket-02) ──────────────────

test('mergeBounceHistoryEntry is a no-op for an entry whose natural key already exists', () => {
  const first = mergeBounceHistoryEntry(ticketYaml(), entry());
  const second = mergeBounceHistoryEntry(first.text, entry({ commit: 'deadbeef00' }));
  assert.equal(second.updated, false);
  assert.equal(second.reason, 'duplicate');
  assert.equal(second.text, first.text);
  assert.equal(parseBounceHistoryEntries(second.text).length, 1);
});

// ── stale/disagreeing bounce_count is never trusted ──────────────────────

test('mergeBounceHistoryEntry recomputes bounce_count from the entry list, never the stale on-disk value', () => {
  const tampered = ticketYaml('bounce_count: 99\n');
  const result = mergeBounceHistoryEntry(tampered, entry());
  assert.equal(result.updated, true);
  assert.match(result.text, /bounce_count: 1\n/);
  assert.doesNotMatch(result.text, /bounce_count: 99/);
});

// ── unparseable YAML degrades, never throws ──────────────────────────────

test('mergeBounceHistoryEntry degrades on unparseable YAML instead of throwing', () => {
  const broken = 'id: BL-606\n  bad: [unterminated\n';
  assert.doesNotThrow(() => {
    const result = mergeBounceHistoryEntry(broken, entry());
    assert.equal(result.updated, false);
    assert.equal(result.reason, 'unparseable');
    assert.equal(result.text, broken);
  });
});
