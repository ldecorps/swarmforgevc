'use strict';
const assert = require('node:assert/strict');
const {
  inventoryFailureModes,
  rankFailureModesByFrequency,
  recordsFromRuleProposalJsonl,
  recordsFromQaBounceJsonl,
  recordsFromCommitSubjects,
  recordsFromChaserJsonl,
  loadInventoryFromContents,
  normalizeSignatureText,
} = require('../out/metrics/failureModeInventory');

test('normalizeSignatureText collapses whitespace and lowercases', () => {
  assert.equal(normalizeSignatureText('  Foo   BAR\n'), 'foo bar');
});

test('BL-512 signatures-grouped-with-count-02: repeated signature collapses to one counted mode', () => {
  const records = [
    { source: 'qa_bounce', signature: 'qa_bounce:behavior:coder', citation: 'a' },
    { source: 'qa_bounce', signature: 'qa_bounce:behavior:coder', citation: 'b' },
    { source: 'qa_bounce', signature: 'qa_bounce:behavior:coder', citation: 'c' },
    { source: 'qa_bounce', signature: 'qa_bounce:unit:coder', citation: 'd' },
  ];
  const groups = inventoryFailureModes(records);
  const behavior = groups.find((g) => g.signature === 'qa_bounce:behavior:coder');
  const unit = groups.find((g) => g.signature === 'qa_bounce:unit:coder');
  assert.equal(behavior.count, 3);
  assert.deepEqual(behavior.citations, ['a', 'b', 'c']);
  assert.equal(unit.count, 1);
  assert.equal(groups.length, 2);
});

test('BL-512 no-evidence-no-mode-06: empty inputs yield no modes', () => {
  assert.deepEqual(inventoryFailureModes([]), []);
  assert.deepEqual(loadInventoryFromContents({}), []);
});

test('BL-512 scan-is-reproducible-05: same inputs → identical grouped counts twice', () => {
  const jsonl = [
    JSON.stringify({ body: 'Same failure twice', scope: 'project', proposer: 'coder' }),
    JSON.stringify({ body: 'Same failure twice', scope: 'project', proposer: 'coder' }),
    JSON.stringify({ body: 'Unique other', scope: 'project', proposer: 'coder' }),
  ].join('\n');
  const a = loadInventoryFromContents({ ruleProposalsJsonl: jsonl });
  const b = loadInventoryFromContents({ ruleProposalsJsonl: jsonl });
  assert.deepEqual(a, b);
  assert.equal(a.find((g) => g.signature.includes('same failure twice')).count, 2);
  assert.equal(a.find((g) => g.signature.includes('unique other')).count, 1);
});

test('recordsFromQaBounceJsonl groups by failureClass:producingRole and cites ticket@commit', () => {
  const jsonl = [
    JSON.stringify({
      ticket: 'BL-1',
      producingRole: 'coder',
      failureClass: 'behavior',
      commit: 'abc',
      at: '2026-07-01T00:00:00.000Z',
      ticketType: 'feature',
    }),
    JSON.stringify({
      ticket: 'BL-2',
      producingRole: 'coder',
      failureClass: 'behavior',
      commit: 'def',
      at: '2026-07-02T00:00:00.000Z',
      ticketType: 'feature',
    }),
  ].join('\n');
  const records = recordsFromQaBounceJsonl(jsonl);
  const groups = inventoryFailureModes(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
  assert.ok(groups[0].citations.some((c) => c.includes('BL-1@abc')));
});

test('recordsFromRuleProposalJsonl skips malformed lines', () => {
  const jsonl = 'not-json\n' + JSON.stringify({ body: 'real one', proposer: 'x' }) + '\n';
  const records = recordsFromRuleProposalJsonl(jsonl);
  assert.equal(records.length, 1);
  assert.match(records[0].signature, /real one/);
});

test('recordsFromCommitSubjects strips ticket prefixes for signature', () => {
  const records = recordsFromCommitSubjects([
    'abc1234 BL-373 Fix phantom revert race',
    'def5678 BL-999 Fix phantom revert race',
  ]);
  const groups = inventoryFailureModes(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test('recordsFromChaserJsonl only counts events at/above minCount and skips resource_sample', () => {
  const jsonl = [
    JSON.stringify({ type: 'chase', role: 'coder', count: 4, at: '2026-07-01T00:00:00Z', handoffId: 'h1' }),
    JSON.stringify({ type: 'chase', role: 'coder', count: 1, at: '2026-07-01T00:01:00Z', handoffId: 'h2' }),
    JSON.stringify({ type: 'resource_sample', role: 'coder', count: 9, at: '2026-07-01T00:02:00Z' }),
  ].join('\n');
  const records = recordsFromChaserJsonl(jsonl, { minCount: 3 });
  assert.equal(records.length, 1);
  assert.equal(records[0].signature, 'chaser:chase:coder');
});

test('rankFailureModesByFrequency sorts by count desc then signature', () => {
  const ranked = rankFailureModesByFrequency([
    { signature: 'b', count: 1, citations: [] },
    { signature: 'a', count: 5, citations: [] },
    { signature: 'c', count: 5, citations: [] },
  ]);
  assert.deepEqual(
    ranked.map((g) => g.signature),
    ['a', 'c', 'b'],
  );
});

test('BL-512 evidence-backed-inventory-01: every group carries at least one citation', () => {
  const groups = inventoryFailureModes([
    { source: 'qa_bounce', signature: 'qa_bounce:behavior:coder', citation: 'cite-1' },
    { source: 'qa_bounce', signature: 'qa_bounce:behavior:coder', citation: 'cite-2' },
  ]);
  for (const g of groups) {
    assert.ok(g.citations.length >= 1, `mode ${g.signature} has no citation`);
  }
});
