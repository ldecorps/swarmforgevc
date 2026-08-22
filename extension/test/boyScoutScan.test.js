const assert = require('node:assert/strict');

const {
  EVIDENCE_SOURCES,
  mergeBySubject,
  rankInventory,
  parseHardeningLedger,
  parseBounceRecords,
  parseCrapReport,
  parseDuplicationReport,
  summarizeRuntimeBloat,
  renderReport,
} = require('../out/tools/boyScoutScan');

// BL-1014. Debt that costs once is just debt; debt that costs again and again
// is what the operator experiences as annoying. RECURRENCE is therefore the
// rank key - not severity, which would be a fresh judgement call each run and
// so could not be deterministic (invariant 1).

// ── the rank key ──────────────────────────────────────────────────────────

test('BL-1014: an item attested by more sources outranks one attested by fewer', () => {
  const ranked = rankInventory(mergeBySubject([
    { subject: 'A', source: 'crap-over-threshold', artifact: 'crap', detail: 'a' },
    { subject: 'B', source: 'crap-over-threshold', artifact: 'crap', detail: 'b' },
    { subject: 'B', source: 'duplication', artifact: 'dry', detail: 'b' },
    { subject: 'B', source: 'deferred-hardening-gate', artifact: 'ledger', detail: 'b' },
  ]));
  assert.deepEqual(ranked.map((i) => i.subject), ['B', 'A']);
  assert.equal(ranked[0].sourceCount, 3);
  assert.equal(ranked[1].sourceCount, 1);
});

test('BL-1014: recurrence counts DISTINCT sources, not repeated hits from one source', () => {
  // Three rows from one source is one source's opinion. Counting rows instead
  // would let a single chatty source outrank genuine cross-source recurrence,
  // which is the whole thing the rank key exists to measure.
  const ranked = rankInventory(mergeBySubject([
    { subject: 'chatty', source: 'crap-over-threshold', artifact: 'crap', detail: '1' },
    { subject: 'chatty', source: 'crap-over-threshold', artifact: 'crap', detail: '2' },
    { subject: 'chatty', source: 'crap-over-threshold', artifact: 'crap', detail: '3' },
    { subject: 'corroborated', source: 'crap-over-threshold', artifact: 'crap', detail: '1' },
    { subject: 'corroborated', source: 'duplication', artifact: 'dry', detail: '1' },
  ]));
  assert.deepEqual(ranked.map((i) => i.subject), ['corroborated', 'chatty']);
});

test('BL-1014: ties break deterministically, with no clock and no input order dependence', () => {
  const forward = rankInventory(mergeBySubject([
    { subject: 'zeta', source: 'duplication', artifact: 'dry', detail: 'z' },
    { subject: 'alpha', source: 'duplication', artifact: 'dry', detail: 'a' },
  ]));
  const reversed = rankInventory(mergeBySubject([
    { subject: 'alpha', source: 'duplication', artifact: 'dry', detail: 'a' },
    { subject: 'zeta', source: 'duplication', artifact: 'dry', detail: 'z' },
  ]));
  assert.deepEqual(forward.map((i) => i.subject), ['alpha', 'zeta']);
  assert.deepEqual(forward, reversed, 'the same evidence in a different order must rank identically');
});

test('BL-1014: every ranked item carries the artifact its rank came from', () => {
  const ranked = rankInventory(mergeBySubject([
    { subject: 'x.ts', source: 'deferred-hardening-gate', artifact: 'backlog/hardening-debt-ledger.yaml', detail: 'BL-620 mutation' },
  ]));
  assert.equal(ranked[0].evidence.length, 1);
  assert.equal(ranked[0].evidence[0].artifact, 'backlog/hardening-debt-ledger.yaml');
  assert.ok(ranked[0].evidence[0].detail.includes('BL-620'),
    'the pointer must be specific enough to open by hand without re-running the scan');
});

// ── the five source parsers ───────────────────────────────────────────────

test('BL-1014: the ledger reader yields one subject per deferred file, naming the ledger', () => {
  const rows = [
    { parcel: 'BL-620', gate: 'mutation', file_set: ['a.ts', 'shared.ts'], reason: 'host busy', detected_at: '2026-08-19' },
    { parcel: 'BL-955', gate: 'mutation', file_set: ['shared.ts'], reason: 'load', detected_at: '2026-08-20' },
  ];
  const ev = parseHardeningLedger(rows);
  const subjects = ev.map((e) => e.subject).sort();
  assert.deepEqual(subjects, ['a.ts', 'shared.ts', 'shared.ts']);
  assert.ok(ev.every((e) => e.source === 'deferred-hardening-gate'));
  assert.ok(ev.every((e) => e.artifact === 'backlog/hardening-debt-ledger.yaml'));
  assert.ok(ev.find((e) => e.detail.includes('BL-620')), 'the parcel that deferred the gate is the evidence');
});

test('BL-1014: bounce recurrence is keyed by class and role - the records carry no file attribution', () => {
  // HONEST LIMIT from the ticket: bounce records carry ticket, producingRole,
  // ticketType, failureClass, commit and at - but NOT the files touched. So
  // this slice ranks by class and role, and must not pretend otherwise.
  const ev = parseBounceRecords([
    JSON.stringify({ ticket: 'BL-1', producingRole: 'coder', failureClass: 'wiring', at: '2026-08-01' }),
    JSON.stringify({ ticket: 'BL-2', producingRole: 'coder', failureClass: 'wiring', at: '2026-08-02' }),
  ]);
  assert.ok(ev.every((e) => e.source === 'bounce-recurrence'));
  assert.ok(ev.every((e) => e.subject === 'wiring/coder'), `got ${ev.map((e) => e.subject)}`);
  assert.ok(ev[0].detail.includes('BL-1'), 'the ticket is the openable evidence pointer');
});

test('BL-1014: a malformed bounce line is skipped, never thrown - a forgiving reader like its siblings', () => {
  const ev = parseBounceRecords(['not json', '', JSON.stringify({ producingRole: 'qa', failureClass: 'docs' })]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].subject, 'docs/qa');
});

test('BL-1014: only CRAP rows over the threshold are debt', () => {
  const tsv = [
    'src/a.ts\tfnA\tcomplexity=9\tcoverage=50%\tCRAP=18.00  *** CRAP > 6 ***',
    'src/b.ts\tfnB\tcomplexity=2\tcoverage=100%\tCRAP=2.00',
  ].join('\n');
  const ev = parseCrapReport(tsv);
  assert.equal(ev.length, 1);
  // Normalised to repo-relative so it can corroborate the ledger's own key.
  assert.equal(ev[0].subject, 'extension/src/a.ts');
  assert.equal(ev[0].source, 'crap-over-threshold');
  assert.ok(ev[0].detail.includes('fnA') && ev[0].detail.includes('18'),
    'the function and its score are what make the rank checkable');
});

test('BL-1014: duplication clones name both files, so a shared clone attests both', () => {
  const ev = parseDuplicationReport('Clone found (typescript):\n - src/a.ts [10:1 - 40:1]\n   src/b.ts [80:1 - 110:1]\n');
  assert.deepEqual(ev.map((e) => e.subject).sort(), ['extension/src/a.ts', 'extension/src/b.ts']);
  assert.ok(ev.every((e) => e.source === 'duplication'));
});

test('BL-1014: runtime bloat is a counted path, and only over its threshold', () => {
  const ev = summarizeRuntimeBloat([
    { path: '.swarmforge/daemon', count: 797, threshold: 100 },
    { path: '.swarmforge/quiet', count: 3, threshold: 100 },
  ]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].subject, '.swarmforge/daemon');
  assert.ok(ev[0].detail.includes('797'), 'the count IS the evidence a human re-checks');
});

// ── the report ────────────────────────────────────────────────────────────

test('BL-1014: a clean repository names every source consulted and says each was clean', () => {
  const report = renderReport({ ranked: [], consulted: EVIDENCE_SOURCES.map((s) => ({ source: s, available: true, count: 0 })) });
  for (const s of EVIDENCE_SOURCES) {
    assert.ok(report.includes(s), `a clean report must still name ${s} - an empty list tells the operator nothing`);
  }
  assert.ok(/clean/i.test(report), 'each consulted source must be stated clean rather than omitted');
});

test('BL-1014: a source that could not be consulted is reported as such, never silently as clean', () => {
  // Failing closed matters here: "no CRAP debt" and "CRAP was never measured"
  // are opposite facts, and collapsing them would let the scan under-report.
  const report = renderReport({
    ranked: [],
    consulted: [{ source: 'crap-over-threshold', available: false, count: 0, why: 'no coverage report' }],
  });
  assert.ok(!/crap-over-threshold[^\n]*clean/i.test(report),
    'an unavailable source must not read as clean');
  assert.ok(report.includes('no coverage report'), 'and must say why it was unavailable');
});

test('BL-1014: all five named sources are declared', () => {
  assert.deepEqual([...EVIDENCE_SOURCES].sort(), [
    'bounce-recurrence', 'crap-over-threshold', 'deferred-hardening-gate', 'duplication', 'runtime-bloat',
  ]);
});

// ── subject normalisation (found by running the scan for real) ────────────
// Every unit test above used consistent subject strings, so all of them passed
// while the scan was useless on the real repository: the ledger names
// "extension/src/tools/x.ts" (repo-relative) but crapReport.js prints
// "src/tools/x.ts" (relative to extension/), so the SAME FILE got two
// different keys and could never corroborate itself. Recurrence across sources
// - the entire rank key - could not fire for any file.

test('BL-1014: CRAP subjects are normalised to repo-relative, so they can corroborate the ledger', () => {
  const ev = parseCrapReport('src/tools/x.ts\tfn\tcomplexity=9\tcoverage=50%\tCRAP=18.00  *** CRAP > 6 ***');
  assert.equal(ev[0].subject, 'extension/src/tools/x.ts');
});

test('BL-1014: duplication subjects are normalised the same way', () => {
  const ev = parseDuplicationReport(' - src/a.ts [10:1 - 40:1]\n   src/b.ts [80:1 - 110:1]\n');
  assert.deepEqual(ev.map((e) => e.subject).sort(), ['extension/src/a.ts', 'extension/src/b.ts']);
});

test('BL-1014: a subject already repo-relative is left alone (normalising twice is not a second prefix)', () => {
  const ev = parseCrapReport('extension/src/tools/x.ts\tfn\tcomplexity=9\tcoverage=50%\tCRAP=18.00  *** CRAP > 6 ***');
  assert.equal(ev[0].subject, 'extension/src/tools/x.ts');
});

test('BL-1014: the ledger and CRAP now agree on one key, so a file in both is attested twice', () => {
  // The corroboration the whole rank key exists to find, end to end.
  const ranked = rankInventory(mergeBySubject([
    ...parseHardeningLedger([{ parcel: 'BL-620', gate: 'mutation', file_set: ['extension/src/tools/x.ts'] }]),
    ...parseCrapReport('src/tools/x.ts\tfn\tcomplexity=9\tcoverage=50%\tCRAP=18.00  *** CRAP > 6 ***'),
    ...parseCrapReport('src/tools/lonely.ts\tfn\tcomplexity=9\tcoverage=50%\tCRAP=18.00  *** CRAP > 6 ***'),
  ]));
  assert.equal(ranked[0].subject, 'extension/src/tools/x.ts');
  assert.equal(ranked[0].sourceCount, 2, 'a file in both the ledger and CRAP must outrank one in CRAP alone');
});

// ── report readability ────────────────────────────────────────────────────

test('BL-1014: an item with many hits from one source shows a bounded sample and says how many were elided', () => {
  // The real run printed 100+ CRAP lines for a single file, which buries the
  // ranking the report exists to convey. Truncation is stated, never silent -
  // a silently shortened list reads as complete.
  const evidence = Array.from({ length: 12 }, (_, i) => ({
    subject: 'extension/src/a.ts', source: 'crap-over-threshold', artifact: 'crap', detail: `fn${i} CRAP=9`,
  }));
  const report = renderReport({ ranked: rankInventory(mergeBySubject(evidence)), consulted: [] });
  const shown = report.split('\n').filter((l) => l.includes('[crap-over-threshold]')).length;
  assert.ok(shown < 12, `expected a bounded sample, got ${shown} lines`);
  assert.ok(/\+\s*\d+\s+more/.test(report), 'the report must say how many it elided');
});
