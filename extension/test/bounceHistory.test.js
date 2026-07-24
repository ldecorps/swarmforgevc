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

// ── parseBounceHistoryEntries tolerates hand-edited whitespace ───────────

test('parseBounceHistoryEntries trims stray whitespace a human hand-editing the file might introduce', () => {
  const text =
    'bounce_history:\n  - { at:  2026-07-23 , by: QA , blamed: coder , class: behavior , commit: 1f7987dd4a , evidence: backlog/evidence/BL-606-qa-bounce-20260723.md  }\n';
  assert.deepEqual(parseBounceHistoryEntries(text), [entry()]);
});

// ── ENTRY_LINE is anchored at both ends, not merely "contains" ───────────

test('parseBounceHistoryEntries ignores an entry-shaped line that does not start at column 0', () => {
  const text = 'bounce_history:\nx' + formatBounceHistoryEntry(entry()) + '\n';
  assert.equal(parseBounceHistoryEntries(text).length, 0);
});

test('parseBounceHistoryEntries ignores an entry line with content packed directly after the closing brace', () => {
  const text = 'bounce_history:\n' + formatBounceHistoryEntry(entry()) + 'EXTRA\n';
  assert.equal(parseBounceHistoryEntries(text).length, 0);
});

// ── stripping only the real bounce_count:/bounce_history: fields, never a ─
// ── mid-sentence mention of the same words in hand-authored prose ────────

test('mergeBounceHistoryEntry does not corrupt prose that merely mentions "bounce_count:" mid-line', () => {
  const before = 'id: BL-606\ndescription: |\n  See the bounce_count: field once this lands.\n';
  const result = mergeBounceHistoryEntry(before, entry());
  assert.match(result.text, /See the bounce_count: field once this lands\.\n/);
});

test('mergeBounceHistoryEntry does not corrupt prose that merely mentions "bounce_history:" mid-line', () => {
  const before = 'id: BL-606\ndescription: |\n  Reads the bounce_history: block once this lands.\n';
  const result = mergeBounceHistoryEntry(before, entry());
  assert.match(result.text, /Reads the bounce_history: block once this lands\.\n/);
});

// ── stripping a prior block/count line survives formatting the real ──────
// ── module never itself produces, but a hand edit plausibly could ────────

test('mergeBounceHistoryEntry strips a bounce_count line with no trailing newline (end of file)', () => {
  const before = 'id: BL-606\nbounce_count: 1';
  const result = mergeBounceHistoryEntry(before, entry());
  assert.equal((result.text.match(/bounce_count:/g) || []).length, 1);
  assert.match(result.text, /bounce_count: 1\n/);
});

test('mergeBounceHistoryEntry still recognizes and replaces a bounce_history block whose header line has trailing whitespace', () => {
  const before = ticketYaml() + 'bounce_count: 1\nbounce_history: \n' + formatBounceHistoryEntry(entry()) + '\n';
  const result = mergeBounceHistoryEntry(before, entry({ at: '2026-07-24', commit: 'deadbeef00' }));
  assert.equal(parseBounceHistoryEntries(result.text).length, 2);
  assert.equal((result.text.match(/^bounce_history:/gm) || []).length, 1);
});

test('mergeBounceHistoryEntry still recognizes and replaces a bounce_history block whose entry line has trailing whitespace', () => {
  const before = ticketYaml() + 'bounce_count: 1\nbounce_history:\n' + formatBounceHistoryEntry(entry()) + '  \n';
  const result = mergeBounceHistoryEntry(before, entry({ at: '2026-07-24', commit: 'deadbeef00' }));
  assert.equal(parseBounceHistoryEntries(result.text).length, 2);
  assert.equal((result.text.match(/^bounce_history:/gm) || []).length, 1);
});

test('mergeBounceHistoryEntry still recognizes a bounce_history block whose last entry line has no trailing newline', () => {
  const before = ticketYaml() + 'bounce_count: 1\nbounce_history:\n' + formatBounceHistoryEntry(entry());
  const result = mergeBounceHistoryEntry(before, entry({ at: '2026-07-24', commit: 'deadbeef00' }));
  assert.equal(parseBounceHistoryEntries(result.text).length, 2);
  assert.equal((result.text.match(/^bounce_history:/gm) || []).length, 1);
});

test('mergeBounceHistoryEntry strips every trailing whitespace character before the ticket body, not just the last one', () => {
  const before = 'id: BL-606\ntitle: "Some ticket"\n\n\n  \n';
  const result = mergeBounceHistoryEntry(before, entry());
  assert.equal(result.text, 'id: BL-606\ntitle: "Some ticket"\nbounce_count: 1\nbounce_history:\n' + formatBounceHistoryEntry(entry()) + '\n');
});

// ── an existing block is replaced cleanly - no stray leftover characters ─
// ── from the old block (exact-text, not just presence checks) ───────────

test('mergeBounceHistoryEntry replaces an existing single-entry block with exact expected text, no stray characters left behind', () => {
  const first = mergeBounceHistoryEntry(ticketYaml(), entry());
  const second = mergeBounceHistoryEntry(first.text, entry({ at: '2026-07-24', commit: 'deadbeef00' }));
  const expectedBody = ticketYaml().replace(/\s+$/, '');
  const expectedBlock = ['bounce_count: 2', 'bounce_history:', formatBounceHistoryEntry(entry()), formatBounceHistoryEntry(entry({ at: '2026-07-24', commit: 'deadbeef00' }))].join(
    '\n'
  );
  assert.equal(second.text, `${expectedBody}\n${expectedBlock}\n`);
});

// ── a block with TWO existing entries must be replaced in full - not just ─
// ── the first repetition of the inner entry-line group ────────────────────

test('mergeBounceHistoryEntry replaces a bounce_history block containing two existing entries, not just the first', () => {
  const first = mergeBounceHistoryEntry(ticketYaml(), entry());
  const second = mergeBounceHistoryEntry(first.text, entry({ at: '2026-07-24', commit: 'deadbeef00' }));
  const third = mergeBounceHistoryEntry(second.text, entry({ at: '2026-07-25', commit: 'cafebabe00', failureClass: 'compile' }));
  assert.equal(parseBounceHistoryEntries(third.text).length, 3);
  assert.equal((third.text.match(/^bounce_history:/gm) || []).length, 1);
});
