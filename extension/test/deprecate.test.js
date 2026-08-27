'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  SIZE_ENVELOPE,
  HARD_TIER_REFUSE_REASON,
  seatAllowsDeprecate,
  rankStaleItems,
  adjudicateTop,
  exceedsEnvelope,
  runDeprecate,
  renderDeprecateReport,
  applyRetirement,
  DEPRECATED_SECTION_HEADING,
} = require('../out/tools/deprecate');

function item(overrides = {}) {
  return {
    subject: 'orphan_flag',
    kind: 'orphan-conf-flag',
    recurrence: 2,
    blastRadius: 1,
    adjudication: 'retire',
    estimatedFiles: 2,
    estimatedLines: 10,
    ...overrides,
  };
}

test('BL-1174: seatAllowsDeprecate accepts hard only', () => {
  assert.equal(seatAllowsDeprecate('hard'), true);
  assert.equal(seatAllowsDeprecate('easy'), false);
  assert.equal(seatAllowsDeprecate('weak'), false);
  assert.equal(seatAllowsDeprecate(undefined), false);
});

test('BL-1174: HARD_TIER_REFUSE_REASON names multi-document reasoner', () => {
  assert.match(HARD_TIER_REFUSE_REASON, /needs hard-tier multi-document reasoner/i);
});

test('BL-1174: rankStaleItems orders by recurrence then blast radius then subject', () => {
  const ranked = rankStaleItems([
    item({ subject: 'b', recurrence: 1, blastRadius: 9 }),
    item({ subject: 'a', recurrence: 3, blastRadius: 1 }),
    item({ subject: 'c', recurrence: 3, blastRadius: 5 }),
  ]);
  assert.deepEqual(
    ranked.map((r) => r.subject),
    ['c', 'a', 'b']
  );
});

test('BL-1174: exceedsEnvelope is inclusive at the limit', () => {
  assert.deepEqual(exceedsEnvelope({ files: 3, lines: 80 }, SIZE_ENVELOPE), []);
  assert.deepEqual(exceedsEnvelope({ files: 4, lines: 10 }, SIZE_ENVELOPE), ['files']);
  assert.deepEqual(exceedsEnvelope({ files: 1, lines: 81 }, SIZE_ENVELOPE), ['lines']);
});

test('BL-1174: dry ranks without mutating', () => {
  const writes = [];
  const result = runDeprecate({
    mode: 'dry',
    seatTier: 'hard',
    signals: [item({ subject: 'dead_flag' })],
    writeFile: (p, c) => writes.push({ p, c }),
    readFile: () => null,
  });
  assert.equal(result.outcome, 'ranked');
  assert.equal(result.dry, true);
  assert.equal(result.items[0].subject, 'dead_flag');
  assert.equal(writes.length, 0);
});

test('BL-1174: weak seat refuses dry and confirm', () => {
  for (const mode of ['dry', 'confirm']) {
    const writes = [];
    const result = runDeprecate({
      mode,
      seatTier: 'easy',
      signals: [item()],
      writeFile: (p, c) => writes.push({ p, c }),
      readFile: () => null,
    });
    assert.equal(result.outcome, 'refused');
    assert.match(result.reason, /hard-tier multi-document reasoner/i);
    assert.equal(writes.length, 0);
  }
});

test('BL-1174: confirm retires top orphan conf flag and links docs', () => {
  const files = new Map([
    ['swarmforge/swarmforge.conf', '# x\nconfig dead_flag 1\nconfig keep_me 1\n'],
    ['docs/index.md', '# Docs\n\n## How-to\n- [x](how-to/x.md)\n'],
  ]);
  const result = runDeprecate({
    mode: 'confirm',
    seatTier: 'hard',
    signals: [item({ subject: 'dead_flag', estimatedFiles: 2, estimatedLines: 8 })],
    writeFile: (p, c) => files.set(p, c),
    readFile: (p) => (files.has(p) ? files.get(p) : null),
  });
  assert.equal(result.outcome, 'retired');
  assert.equal(result.subject, 'dead_flag');
  assert.match(result.stubPath, /^docs\/deprecated\//);
  assert.equal(result.indexLinked, true);
  assert.ok(!files.get('swarmforge/swarmforge.conf').includes('dead_flag'));
  assert.ok(files.get('swarmforge/swarmforge.conf').includes('keep_me'));
  assert.ok(files.has(result.stubPath));
  assert.match(files.get('docs/index.md'), new RegExp(DEPRECATED_SECTION_HEADING));
  assert.match(files.get('docs/index.md'), /deprecated\//);
});

test('BL-1174: ambiguous top item asks human and writes nothing', () => {
  const writes = [];
  const result = runDeprecate({
    mode: 'confirm',
    seatTier: 'hard',
    signals: [
      item({
        subject: 'maybe_flag',
        adjudication: 'human-ask',
        ambiguityReason: 'still referenced in one living how-to',
      }),
    ],
    writeFile: (p, c) => writes.push({ p, c }),
    readFile: () => null,
  });
  assert.equal(result.outcome, 'human-ask');
  assert.equal(result.subject, 'maybe_flag');
  assert.equal(writes.length, 0);
});

test('BL-1174: oversized retirement refuses with reason', () => {
  const writes = [];
  const result = runDeprecate({
    mode: 'confirm',
    seatTier: 'hard',
    signals: [item({ subject: 'huge', estimatedFiles: 9, estimatedLines: 400 })],
    writeFile: (p, c) => writes.push({ p, c }),
    readFile: () => null,
  });
  assert.equal(result.outcome, 'refused');
  assert.match(result.reason, /envelope|oversized|size/i);
  assert.equal(writes.length, 0);
});

test('BL-1174: adjudicateTop never auto-closes tickets', () => {
  const decision = adjudicateTop(item({ adjudication: 'defect' }));
  assert.equal(decision.action, 'defect');
  assert.equal(decision.closesTicket, false);
});

test('BL-1174: applyRetirement removes only the named conf flag', () => {
  const before = 'config a 1\nconfig b 2\nconfig c 3\n';
  const after = applyRetirement.removeConfFlag(before, 'b');
  assert.equal(after, 'config a 1\nconfig c 3\n');
});

test('BL-1174: renderDeprecateReport is readable for ranked dry runs', () => {
  const text = renderDeprecateReport({
    outcome: 'ranked',
    dry: true,
    items: [item({ subject: 'dead_flag', recurrence: 2, blastRadius: 1 })],
  });
  assert.match(text, /deprecate dry/i);
  assert.match(text, /dead_flag/);
});

test('BL-1174: confirm refuses closing any backlog ticket path', () => {
  const files = new Map([
    ['swarmforge/swarmforge.conf', 'config dead_flag 1\n'],
    ['docs/index.md', '# Docs\n'],
    ['backlog/active/BL-9.yaml', 'id: BL-9\nstatus: todo\n'],
  ]);
  runDeprecate({
    mode: 'confirm',
    seatTier: 'hard',
    signals: [item({ subject: 'dead_flag' })],
    writeFile: (p, c) => files.set(p, c),
    readFile: (p) => (files.has(p) ? files.get(p) : null),
  });
  assert.equal(files.get('backlog/active/BL-9.yaml'), 'id: BL-9\nstatus: todo\n');
});
