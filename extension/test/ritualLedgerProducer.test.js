const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  RITUAL_LEDGER_WINDOW_DAYS,
  parseRitualCommitLog,
  readPersistedRitualLedger,
  ritualLedgerStorePath,
  runRitualLedgerProducer,
  writeRitualLedger,
} = require('../out/metrics/ritualLedgerProducer');
const { RITUAL_VOLUME_FLOOR } = require('../out/metrics/ritualLedger');
const { runClosingCeremony } = require('../out/metrics/closingCeremonyRun');
const { isEmptyCeremonyPacket } = require('../out/quality/closingCeremony');

function logBody(entries) {
  return entries.map(({ subject, paths }) => [`COMMIT\t${subject}`, ...paths, ''].join('\n')).join('');
}

function handMadeEntries(n, dir = 'backlog/evidence') {
  return Array.from({ length: n }, (_u, i) => ({
    subject: `a hand written subject ${'w'.repeat(i + 1)}`,
    paths: [`${dir}/BL-${i}-coder.md`],
  }));
}

function scriptedEntries(n) {
  return Array.from({ length: n }, (_u, i) => ({
    subject: 'Close BL-1: move to done. By coordinator.',
    paths: [`backlog/active/BL-${i}-a.yaml`],
  }));
}

// ── the log parser ───────────────────────────────────────────────────────

describe('parseRitualCommitLog', () => {
  it('reads a subject and the paths that follow it', () => {
    const parsed = parseRitualCommitLog(logBody([{ subject: 'a subject', paths: ['a/b.ts', 'c/d.ts'] }]));
    assert.deepEqual(parsed, [{ subject: 'a subject', paths: ['a/b.ts', 'c/d.ts'] }]);
  });

  it('separates consecutive commits', () => {
    const parsed = parseRitualCommitLog(
      logBody([
        { subject: 'first', paths: ['a.ts'] },
        { subject: 'second', paths: ['b.ts'] },
      ])
    );
    assert.deepEqual(parsed.map((c) => c.subject), ['first', 'second']);
    assert.deepEqual(parsed.map((c) => c.paths), [['a.ts'], ['b.ts']]);
  });

  it('keeps an empty commit, with no paths', () => {
    const parsed = parseRitualCommitLog(logBody([{ subject: 'empty', paths: [] }]));
    assert.deepEqual(parsed, [{ subject: 'empty', paths: [] }]);
  });

  it('is empty for empty output', () => {
    assert.deepEqual(parseRitualCommitLog(''), []);
  });

  it('does not mistake a path for a subject line', () => {
    const parsed = parseRitualCommitLog(logBody([{ subject: 'x', paths: ['docs/COMMIT_GUIDE.md'] }]));
    assert.deepEqual(parsed[0].paths, ['docs/COMMIT_GUIDE.md']);
  });
});

// ── producer + store ─────────────────────────────────────────────────────

describe('runRitualLedgerProducer', () => {
  it('folds the log into a stored ledger without touching git or disk when seams are injected', () => {
    const written = [];
    const result = runRitualLedgerProducer({
      repoRoot: '/nowhere',
      nowIso: '2026-09-05T00:00:00.000Z',
      readLogFn: () => logBody(handMadeEntries(3)),
      writeFn: (record) => written.push(record),
    });
    assert.equal(result.commitsScanned, 3);
    assert.deepEqual(result.classes, ['pass-bounce-evidence']);
    assert.equal(written.length, 1);
    assert.equal(written[0].windowDays, RITUAL_LEDGER_WINDOW_DAYS);
    assert.equal(written[0].computedAt, '2026-09-05T00:00:00.000Z');
  });

  it('round-trips through the real store', () => {
    const root = mkTmpDir('sfvc-bl1365-store-');
    try {
      const telemetryDir = path.join(root, '.swarmforge', 'telemetry');
      runRitualLedgerProducer({
        repoRoot: root,
        nowIso: '2026-09-05T00:00:00.000Z',
        readLogFn: () => logBody(handMadeEntries(4)),
      });
      assert.ok(fs.existsSync(ritualLedgerStorePath(telemetryDir)));
      const back = readPersistedRitualLedger(telemetryDir);
      assert.equal(back.commitsScanned, 4);
      assert.equal(back.ledger[0].ritualClass, 'pass-bounce-evidence');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads back null rather than throwing when there is no ledger yet', () => {
    const root = mkTmpDir('sfvc-bl1365-noledger-');
    try {
      assert.equal(readPersistedRitualLedger(path.join(root, '.swarmforge', 'telemetry')), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads back null rather than throwing on a corrupt ledger', () => {
    const root = mkTmpDir('sfvc-bl1365-corrupt-');
    try {
      const telemetryDir = path.join(root, '.swarmforge', 'telemetry');
      fs.mkdirSync(telemetryDir, { recursive: true });
      fs.writeFileSync(ritualLedgerStorePath(telemetryDir), '{not json', 'utf8');
      assert.equal(readPersistedRitualLedger(telemetryDir), null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── the ceremony reads it (invariants 1 and 2, end to end) ───────────────

function ceremonyFixture(entries, openTicketTexts) {
  const root = mkTmpDir('sfvc-bl1365-ceremony-');
  runRitualLedgerProducer({
    repoRoot: root,
    nowIso: '2026-09-05T00:00:00.000Z',
    readLogFn: () => logBody(entries),
  });
  const sent = [];
  const result = runClosingCeremony(root, '2026-09-05T18:00:00.000Z', {
    sendNote: (_target, draft) => sent.push(draft),
    readWindowModels: () => ({}),
    readOpenTicketTexts: () => openTicketTexts,
  });
  return { root, result, sent };
}

describe('the closing ceremony reads the ritual ledger', () => {
  it('offers a hand-made class as a candidate carrying its volume and spread', () => {
    const { root, result } = ceremonyFixture(handMadeEntries(RITUAL_VOLUME_FLOOR + 10), []);
    try {
      const [candidate] = result.run.packet.determinismCandidates;
      assert.equal(candidate.ritualClass, 'pass-bounce-evidence');
      assert.equal(candidate.commits, RITUAL_VOLUME_FLOOR + 10);
      assert.equal(candidate.distinctSubjects, RITUAL_VOLUME_FLOOR + 10);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not offer a scripted class', () => {
    const { root, result } = ceremonyFixture(scriptedEntries(RITUAL_VOLUME_FLOOR + 10), []);
    try {
      assert.deepEqual(result.run.packet.determinismCandidates, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops offering a class once an open ticket names it', () => {
    const { root, result } = ceremonyFixture(handMadeEntries(RITUAL_VOLUME_FLOOR + 10), [
      'title: nobody scripts backlog/evidence/ yet',
    ]);
    try {
      assert.deepEqual(result.run.packet.determinismCandidates, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a candidate alone is not an empty packet, so it is delivered not auto-closed', () => {
    const { root, result, sent } = ceremonyFixture(handMadeEntries(RITUAL_VOLUME_FLOOR + 10), []);
    try {
      assert.equal(isEmptyCeremonyPacket(result.run.packet), false);
      assert.equal(result.status, 'created');
      assert.equal(result.run.outcome, null, 'the specifier still judges it');
      assert.equal(sent.length, 1, 'the packet reaches the specifier as a note');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('with every class scripted or ticketed the ceremony records a reasoned no-change', () => {
    const { root, result } = ceremonyFixture(
      [...scriptedEntries(RITUAL_VOLUME_FLOOR + 10), ...handMadeEntries(RITUAL_VOLUME_FLOOR + 10)],
      ['names backlog/evidence/ already']
    );
    try {
      assert.deepEqual(result.run.packet.determinismCandidates, []);
      assert.equal(result.status, 'auto_no_change');
      assert.equal(result.run.outcome.type, 'no_change');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a window whose ceremony never ran still offers its candidates later', () => {
    const root = mkTmpDir('sfvc-bl1365-skipped-');
    try {
      // The ledger accrues on its own cadence...
      runRitualLedgerProducer({
        repoRoot: root,
        nowIso: '2026-09-03T00:00:00.000Z',
        readLogFn: () => logBody(handMadeEntries(RITUAL_VOLUME_FLOOR + 10)),
      });
      // ...no ceremony runs for that window at all...
      assert.equal(fs.existsSync(path.join(root, '.swarmforge', 'lean', 'ceremony', '2026-09-03.json')), false);
      // ...and a LATER ceremony still sees the measurement.
      const later = runClosingCeremony(root, '2026-09-05T18:00:00.000Z', {
        sendNote: () => undefined,
        readWindowModels: () => ({}),
        readOpenTicketTexts: () => [],
      });
      assert.deepEqual(
        later.run.packet.determinismCandidates.map((c) => c.ritualClass),
        ['pass-bounce-evidence']
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a missing ledger leaves the rest of the ceremony working', () => {
    const root = mkTmpDir('sfvc-bl1365-noledger-ceremony-');
    try {
      const result = runClosingCeremony(root, '2026-09-05T18:00:00.000Z', {
        sendNote: () => undefined,
        readWindowModels: () => ({}),
        readOpenTicketTexts: () => [],
      });
      assert.deepEqual(result.run.packet.determinismCandidates, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── the default open-ticket reader ───────────────────────────────────────

describe('readOpenTicketTextsFromTarget', () => {
  const { readOpenTicketTextsFromTarget } = require('../out/metrics/closingCeremonyRun');

  it('reads active and paused, and ignores done', () => {
    const root = mkTmpDir('sfvc-bl1365-tickets-');
    try {
      for (const [dir, body] of [
        ['active', 'ACTIVE BODY'],
        ['paused', 'PAUSED BODY'],
        ['done', 'DONE BODY'],
        ['hold', 'HOLD BODY'],
      ]) {
        fs.mkdirSync(path.join(root, 'backlog', dir), { recursive: true });
        fs.writeFileSync(path.join(root, 'backlog', dir, 'BL-1-x.yaml'), body, 'utf8');
      }
      const texts = readOpenTicketTextsFromTarget(root).join('\n');
      assert.match(texts, /ACTIVE BODY/);
      assert.match(texts, /PAUSED BODY/);
      assert.doesNotMatch(texts, /DONE BODY/);
      assert.doesNotMatch(texts, /HOLD BODY/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('is empty when no backlog directories exist', () => {
    const root = mkTmpDir('sfvc-bl1365-nobacklog-');
    try {
      assert.deepEqual(readOpenTicketTextsFromTarget(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
