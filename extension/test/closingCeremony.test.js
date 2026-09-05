const assert = require('node:assert/strict');
const {
  buildClosingCeremonyPacket,
  eventsForShiftKey,
  isEmptyCeremonyPacket,
  isKnownCeremonyOutcomeType,
  isKnownCeremonyAdjustmentKind,
  isValidCeremonyOutcome,
  isValidCeremonyAdjustment,
  ceremonyRunState,
  buildClosingCeremonyNoteDraft,
  buildCeremonyFailureNoteDraft,
  markQualityRecommendationsRefused,
} = require('../out/quality/closingCeremony');

// BL-820: pure core for the closing-ceremony lean pass - the shift-scoped
// packet folded from BL-819's lifecycle ledger, and the closed-vocabulary
// validators for outcomes/adjustments that keep the ceremony's "reversible
// from the record alone" contract (human decision 7) enforceable.

function event(overrides = {}) {
  return {
    ticket: 'BL-900',
    type: 'stage_transition',
    source: 'stage-dwell',
    at: '2026-08-08T10:00:00.000Z',
    role: 'coder',
    data: { queueWaitMs: 100, processingMs: 1000 },
    ...overrides,
  };
}

// ── eventsForShiftKey / shift scoping ──────────────────────────────────

test('eventsForShiftKey keeps only events whose `at` date matches the shift key', () => {
  const events = [event({ at: '2026-08-08T09:00:00.000Z' }), event({ at: '2026-08-07T09:00:00.000Z' })];
  assert.deepEqual(eventsForShiftKey(events, '2026-08-08'), [events[0]]);
});

// ── buildClosingCeremonyPacket: each named field ───────────────────────

test('packet names the path taken - distinct roles, first-seen order', () => {
  const events = [
    event({ role: 'coder', at: '2026-08-08T09:00:00.000Z' }),
    event({ role: 'cleaner', at: '2026-08-08T09:05:00.000Z' }),
    event({ role: 'coder', at: '2026-08-08T09:10:00.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.pathTaken, ['coder', 'cleaner']);
});

test('packet names dwell hotspots - disjoint parcel windows sum to their total, descending', () => {
  const events = [
    event({ role: 'coder', data: { processingMs: 5000 }, at: '2026-08-08T09:00:00.000Z' }),
    event({ role: 'coder', data: { processingMs: 3000 }, at: '2026-08-08T09:05:00.000Z' }),
    event({ role: 'architect', data: { processingMs: 20000 }, at: '2026-08-08T09:10:00.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.dwellHotspots, [
    { role: 'architect', totalMs: 20000 },
    { role: 'coder', totalMs: 8000 },
  ]);
});

// BL-923: cleaner/hardender are batch roles - several parcels dequeue and
// complete together, so their stage-transition exit events carry the SAME
// (or overlapping) [at - processingMs, at] window. Summing double/triple
// counts that one window. Dwell must total the UNION of occupied time.
test('BL-923: two parcels sharing the exact same window count that window once, not twice', () => {
  const events = [
    event({ role: 'hardender', data: { processingMs: 1772000 }, at: '2026-08-18T07:44:39.000Z' }),
    event({ role: 'hardender', data: { processingMs: 1772000 }, at: '2026-08-18T07:44:39.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-18', events);
  assert.deepEqual(packet.dwellHotspots, [{ role: 'hardender', totalMs: 1772000 }]);
});

test('BL-923: three parcels sharing one batch window count that window once', () => {
  const events = [
    event({ role: 'hardender', data: { processingMs: 1772000 }, at: '2026-08-18T07:44:39.000Z' }),
    event({ role: 'hardender', data: { processingMs: 1772000 }, at: '2026-08-18T07:44:39.000Z' }),
    event({ role: 'hardender', data: { processingMs: 1772000 }, at: '2026-08-18T07:44:39.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-18', events);
  assert.deepEqual(packet.dwellHotspots, [{ role: 'hardender', totalMs: 1772000 }]);
});

test('BL-923: two parcel windows that partially overlap count the span they jointly occupied', () => {
  // window A: [09:00:00, 09:00:40) (40000ms up to 09:00:40)
  // window B: [09:00:20, 09:01:10) (50000ms up to 09:01:10)
  // joint span: 09:00:00 -> 09:01:10 = 70000ms, not 40000+50000=90000ms
  const events = [
    event({ role: 'cleaner', data: { processingMs: 40000 }, at: '2026-08-08T09:00:40.000Z' }),
    event({ role: 'cleaner', data: { processingMs: 50000 }, at: '2026-08-08T09:01:10.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.dwellHotspots, [{ role: 'cleaner', totalMs: 70000 }]);
});

test('BL-923: a batch role whose summed windows exceed a serial role but whose occupied time does not ranks below it, and the hypothesis names the serial role', () => {
  const events = [
    // hardender: three parcels sharing one 6000ms window - summed would be 18000ms.
    event({ role: 'hardender', data: { processingMs: 6000 }, at: '2026-08-08T09:00:06.000Z' }),
    event({ role: 'hardender', data: { processingMs: 6000 }, at: '2026-08-08T09:00:06.000Z' }),
    event({ role: 'hardender', data: { processingMs: 6000 }, at: '2026-08-08T09:00:06.000Z' }),
    // QA: one parcel, a disjoint 10000ms window - genuinely occupied longer than hardender's real 6000ms.
    event({ role: 'QA', data: { processingMs: 10000 }, at: '2026-08-08T10:00:10.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.dwellHotspots, [
    { role: 'QA', totalMs: 10000 },
    { role: 'hardender', totalMs: 6000 },
  ]);
  assert.ok(packet.hypotheses.some((h) => h.startsWith('Longest dwell this shift: QA')), `expected the QA hypothesis, got: ${JSON.stringify(packet.hypotheses)}`);
});

test('packet names bounce classes - counted, descending', () => {
  const events = [
    event({ type: 'bounce', source: 'bounce-store', data: { failureClass: 'behavior' }, at: '2026-08-08T09:00:00.000Z' }),
    event({ type: 'bounce', source: 'bounce-store', data: { failureClass: 'behavior' }, at: '2026-08-08T09:05:00.000Z' }),
    event({ type: 'bounce', source: 'bounce-store', data: { failureClass: 'unit' }, at: '2026-08-08T09:10:00.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.bounceClasses, [
    { failureClass: 'behavior', count: 2 },
    { failureClass: 'unit', count: 1 },
  ]);
});

test('packet names skip reasons - deduped, first-seen order', () => {
  const events = [
    event({ type: 'stage_skip', source: 'routing-skip-log', role: 'cleaner', data: { reason: 'bounded single-lib change' }, at: '2026-08-08T09:00:00.000Z' }),
    event({ type: 'stage_skip', source: 'routing-skip-log', role: 'architect', data: { reason: 'bounded single-lib change' }, at: '2026-08-08T09:05:00.000Z' }),
    event({ type: 'stage_skip', source: 'routing-skip-log', role: 'hardener', data: { reason: 'docs-only' }, at: '2026-08-08T09:10:00.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.skipReasons, ['bounded single-lib change', 'docs-only']);
});

test('packet names stalls - counted per role+eventType', () => {
  const events = [
    event({ type: 'stall', source: 'chaser-telemetry', role: 'coder', data: { eventType: 'nudge', count: 1 }, at: '2026-08-08T09:00:00.000Z' }),
    event({ type: 'stall', source: 'chaser-telemetry', role: 'coder', data: { eventType: 'nudge', count: 1 }, at: '2026-08-08T09:05:00.000Z' }),
    event({ type: 'stall', source: 'chaser-telemetry', role: 'coder', data: { eventType: 'chase', count: 2 }, at: '2026-08-08T09:10:00.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.stalls.sort((a, b) => a.eventType.localeCompare(b.eventType)), [
    { role: 'coder', eventType: 'chase', count: 1 },
    { role: 'coder', eventType: 'nudge', count: 2 },
  ]);
});

test('packet excludes tickets from other shifts (only the requested day)', () => {
  const events = [
    event({ role: 'coder', at: '2026-08-08T09:00:00.000Z' }),
    event({ role: 'yesterday-only-role', at: '2026-08-07T09:00:00.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.ok(!packet.pathTaken.includes('yesterday-only-role'));
});

test('packet contains no raw log transcript - closed field shape only', () => {
  const packet = buildClosingCeremonyPacket('2026-08-08', [event()]);
  assert.deepEqual(
    Object.keys(packet).sort(),
    ['bounceClasses', 'determinismCandidates', 'dwellHotspots', 'hypotheses', 'pathTaken', 'qualityRecommendations', 'shiftKey', 'skipReasons', 'stalls'].sort()
  );
});

// ── BL-1119: per-role quality dial from lean signals ───────────────────

test('BL-1119: elevated stalls for a role recommend quality raise citing stalls', () => {
  const events = [
    event({ type: 'stall', source: 'chaser-telemetry', role: 'coder', data: { eventType: 'chase', count: 1 } }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.qualityRecommendations, [
    { role: 'coder', dial: 'raise', citedFields: ['stalls'], disposition: 'recommended' },
  ]);
});

test('BL-1119: bounce blamedRole recommends quality raise citing bounce.blamedRole', () => {
  const events = [
    {
      ticket: 'BL-900',
      type: 'bounce',
      source: 'bounce-store',
      at: '2026-08-08T10:00:00.000Z',
      data: { blamedRole: 'architect', failureClass: 'behavior' },
    },
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.qualityRecommendations, [
    { role: 'architect', dial: 'raise', citedFields: ['bounce.blamedRole'], disposition: 'recommended' },
  ]);
});

test('BL-1119: clean stage work without rework recommends quality lower', () => {
  const events = [event({ role: 'cleaner', data: { processingMs: 1000 } })];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.deepEqual(packet.qualityRecommendations, [
    { role: 'cleaner', dial: 'lower', citedFields: ['stage_transition'], disposition: 'recommended' },
  ]);
});

test('BL-1119: markQualityRecommendationsRefused sets disposition refused without changing dial', () => {
  const packet = buildClosingCeremonyPacket('2026-08-08', [
    event({ type: 'stall', source: 'chaser-telemetry', role: 'coder', data: { eventType: 'chase', count: 1 } }),
  ]);
  const refused = markQualityRecommendationsRefused(packet);
  assert.equal(refused.qualityRecommendations[0].disposition, 'refused');
  assert.equal(refused.qualityRecommendations[0].dial, 'raise');
});

test('BL-1119: auto window model never raise/lower — hold only even with stalls', () => {
  const events = [
    event({ type: 'stall', source: 'chaser-telemetry', role: 'coder', data: { eventType: 'chase', count: 1 } }),
  ];
  for (const model of ['auto', 'cursor/auto', 'copilot/auto']) {
    const packet = buildClosingCeremonyPacket('2026-08-08', events, { coder: model });
    assert.deepEqual(
      packet.qualityRecommendations,
      [{ role: 'coder', dial: 'hold', citedFields: ['stalls'], disposition: 'held' }],
      `model ${model}`
    );
  }
});

test('BL-1119: isAutoWindowModel recognizes auto and */auto', () => {
  const { isAutoWindowModel } = require('../out/quality/closingCeremony');
  assert.equal(isAutoWindowModel('auto'), true);
  assert.equal(isAutoWindowModel('cursor/auto'), true);
  assert.equal(isAutoWindowModel('copilot/auto'), true);
  assert.equal(isAutoWindowModel('opus'), false);
  assert.equal(isAutoWindowModel(''), false);
});

test('BL-1119: parseWindowModelsFromConf reads window --model lines', () => {
  const { parseWindowModelsFromConf } = require('../out/quality/closingCeremony');
  const conf = [
    'window specifier cursor master --model auto',
    'window coder cursor coder --model opus',
    'window cleaner claude cleaner',
    '# comment',
  ].join('\n');
  assert.deepEqual(parseWindowModelsFromConf(conf), {
    specifier: 'auto',
    coder: 'opus',
  });
});

// ── hypotheses: 1-3, derived from whatever signal is present ───────────

test('a shift with real signal carries between one and three hypotheses', () => {
  const events = [
    event({ role: 'coder', data: { processingMs: 5000 }, at: '2026-08-08T09:00:00.000Z' }),
    event({ type: 'bounce', source: 'bounce-store', data: { failureClass: 'behavior' }, at: '2026-08-08T09:05:00.000Z' }),
    event({ type: 'stall', source: 'chaser-telemetry', role: 'coder', data: { eventType: 'chase', count: 1 }, at: '2026-08-08T09:10:00.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.ok(packet.hypotheses.length >= 1 && packet.hypotheses.length <= 3, JSON.stringify(packet.hypotheses));
});

test('hypotheses cap at three even with dwell, bounce, and stall signal all present', () => {
  const events = [
    event({ role: 'coder', data: { processingMs: 5000 }, at: '2026-08-08T09:00:00.000Z' }),
    event({ type: 'bounce', source: 'bounce-store', data: { failureClass: 'behavior' }, at: '2026-08-08T09:05:00.000Z' }),
    event({ type: 'stall', source: 'chaser-telemetry', role: 'coder', data: { eventType: 'chase', count: 1 }, at: '2026-08-08T09:10:00.000Z' }),
  ];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.equal(packet.hypotheses.length, 3);
});

test('a shift with only stage-skip signal still gets a hypothesis (fallback)', () => {
  const events = [event({ type: 'stage_skip', source: 'routing-skip-log', role: 'cleaner', data: { reason: 'docs-only' }, at: '2026-08-08T09:00:00.000Z' })];
  const packet = buildClosingCeremonyPacket('2026-08-08', events);
  assert.equal(packet.hypotheses.length, 1);
});

// ── isEmptyCeremonyPacket ────────────────────────────────────────────────

test('a shift with no ledger entries produces an empty packet', () => {
  const packet = buildClosingCeremonyPacket('2026-08-08', []);
  assert.equal(isEmptyCeremonyPacket(packet), true);
  assert.deepEqual(packet.hypotheses, []);
});

test('a shift with any real entry is not empty', () => {
  const packet = buildClosingCeremonyPacket('2026-08-08', [event()]);
  assert.equal(isEmptyCeremonyPacket(packet), false);
});

// ── outcome validation (closed vocabulary + reversibility) ─────────────

test('isKnownCeremonyOutcomeType accepts exactly the three known outcome types', () => {
  assert.equal(isKnownCeremonyOutcomeType('process_ticket'), true);
  assert.equal(isKnownCeremonyOutcomeType('spec_gate_tweak'), true);
  assert.equal(isKnownCeremonyOutcomeType('no_change'), true);
  assert.equal(isKnownCeremonyOutcomeType('something_else'), false);
});

test('a no_change outcome is valid with no ref - nothing to reverse', () => {
  assert.equal(isValidCeremonyOutcome({ type: 'no_change', ref: null, recordedAt: '2026-08-08T22:00:00.000Z' }), true);
});

test('a process_ticket outcome without a ref is invalid - not reversible from the record alone', () => {
  assert.equal(isValidCeremonyOutcome({ type: 'process_ticket', ref: null, recordedAt: '2026-08-08T22:00:00.000Z' }), false);
  assert.equal(isValidCeremonyOutcome({ type: 'process_ticket', ref: '', recordedAt: '2026-08-08T22:00:00.000Z' }), false);
});

test('a process_ticket outcome with a ref is valid', () => {
  assert.equal(isValidCeremonyOutcome({ type: 'process_ticket', ref: 'BL-901', recordedAt: '2026-08-08T22:00:00.000Z' }), true);
});

test('an outcome with an unknown type is invalid', () => {
  assert.equal(isValidCeremonyOutcome({ type: 'shrug', ref: null, recordedAt: '2026-08-08T22:00:00.000Z' }), false);
});

// ── adjustment validation (closed vocabulary + reversibility) ──────────

test('isKnownCeremonyAdjustmentKind accepts exactly promotion_order and throttle_posture', () => {
  assert.equal(isKnownCeremonyAdjustmentKind('promotion_order'), true);
  assert.equal(isKnownCeremonyAdjustmentKind('throttle_posture'), true);
  assert.equal(isKnownCeremonyAdjustmentKind('reprioritize_backlog_schema'), false);
});

test('a well-formed adjustment (ticketed) is valid', () => {
  assert.equal(
    isValidCeremonyAdjustment({
      kind: 'promotion_order',
      detail: 'promoted BL-901 ahead of BL-902 to relieve the dwell hotspot',
      record: { form: 'ticket', ref: 'BL-901' },
      recordedAt: '2026-08-08T22:00:00.000Z',
    }),
    true
  );
});

test('an adjustment with an unknown kind is invalid', () => {
  assert.equal(
    isValidCeremonyAdjustment({
      kind: 'reprioritize_backlog_schema',
      detail: 'x',
      record: { form: 'ticket', ref: 'BL-901' },
      recordedAt: '2026-08-08T22:00:00.000Z',
    }),
    false
  );
});

test('an adjustment with no reversibility ref is invalid', () => {
  assert.equal(
    isValidCeremonyAdjustment({
      kind: 'throttle_posture',
      detail: 'x',
      record: { form: 'note', ref: '' },
      recordedAt: '2026-08-08T22:00:00.000Z',
    }),
    false
  );
});

// ── ceremonyRunState ─────────────────────────────────────────────────

function run(overrides = {}) {
  return {
    shiftKey: '2026-08-08',
    packet: buildClosingCeremonyPacket('2026-08-08', [event()]),
    deliveredAt: '2026-08-08T20:00:00.000Z',
    outcome: null,
    adjustments: [],
    failedAt: null,
    ...overrides,
  };
}

test('a run with neither outcome nor failedAt is pending', () => {
  assert.equal(ceremonyRunState(run()), 'pending');
});

test('a run with an outcome is complete, even if failedAt is also (impossibly) set', () => {
  assert.equal(ceremonyRunState(run({ outcome: { type: 'no_change', ref: null, recordedAt: '2026-08-08T20:00:00.000Z' } })), 'complete');
});

test('a run with failedAt and no outcome is failed', () => {
  assert.equal(ceremonyRunState(run({ failedAt: '2026-08-09T20:00:00.000Z' })), 'failed');
});

// ── note drafts: pointer, never the packet text; under the 80-char cap ──

test('buildClosingCeremonyNoteDraft points at the packet file, never copies packet content', () => {
  const draft = buildClosingCeremonyNoteDraft('specifier', '.swarmforge/lean/ceremony/2026-08-08.json');
  assert.equal(draft, 'type: note\nto: specifier\npriority: 00\nmessage: Closing ceremony packet ready: .swarmforge/lean/ceremony/2026-08-08.json\n');
  const messageLine = draft.split('\n').find((l) => l.startsWith('message:'));
  assert.ok(messageLine.length - 'message: '.length <= 80, `message too long: ${messageLine}`);
});

test('buildCeremonyFailureNoteDraft is a note under the 80-char message cap', () => {
  const draft = buildCeremonyFailureNoteDraft('specifier', '2026-08-08');
  const messageLine = draft.split('\n').find((l) => l.startsWith('message:'));
  assert.ok(messageLine.length - 'message: '.length <= 80, `message too long: ${messageLine}`);
  assert.ok(messageLine.includes('FAILED'));
});
