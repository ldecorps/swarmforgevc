'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseArgs,
  classifySurface,
  buildIdentifyUnusedReport,
  readUsageLedger,
  writePendingNotification,
  runDeprecatorIdentifyUnusedScan,
} = require('../out/tools/deprecate-identify-unused');

function writeLedger(root, entries) {
  const dir = path.join(root, '.swarmforge', 'deprecator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'usage-ledger.json'), JSON.stringify(entries));
}

test('parseArgs requires a project root', () => {
  assert.equal(parseArgs([]), null);
  assert.deepEqual(parseArgs(['/repo']), { root: '/repo' });
});

test('classifySurface: 0 hits is unused, never seldom', () => {
  assert.equal(classifySurface(0), 'unused');
});

test('classifySurface: 1-2 hits is seldom', () => {
  assert.equal(classifySurface(1), 'seldom');
  assert.equal(classifySurface(2), 'seldom');
});

test('classifySurface: 3+ hits is omitted (null)', () => {
  assert.equal(classifySurface(3), null);
  assert.equal(classifySurface(40), null);
});

test('readUsageLedger: missing file fails open (available:false, empty)', () => {
  const root = mkTmpDir('bl1186-noledger-');
  assert.deepEqual(readUsageLedger(root), { available: false, entries: [] });
});

test('readUsageLedger: malformed JSON fails open, never throws', () => {
  const root = mkTmpDir('bl1186-badledger-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'deprecator'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'deprecator', 'usage-ledger.json'), 'not json');
  assert.deepEqual(readUsageLedger(root), { available: false, entries: [] });
});

test('readUsageLedger: non-array JSON fails open', () => {
  const root = mkTmpDir('bl1186-objledger-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'deprecator'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'deprecator', 'usage-ledger.json'), JSON.stringify({ not: 'an array' }));
  assert.deepEqual(readUsageLedger(root), { available: false, entries: [] });
});

test('readUsageLedger: a real ledger is read and malformed entries are dropped', () => {
  const root = mkTmpDir('bl1186-realledger-');
  writeLedger(root, [
    { surface: 'legacy.chase.enabled', hits90d: 0 },
    { surface: 'bad-entry-missing-hits' },
    { hits90d: 5 },
    'not-an-object',
  ]);
  const { available, entries } = readUsageLedger(root);
  assert.equal(available, true);
  assert.deepEqual(entries, [{ surface: 'legacy.chase.enabled', hits90d: 0 }]);
});

test('buildIdentifyUnusedReport: unused-never-seen-01 shape', () => {
  const report = buildIdentifyUnusedReport([{ surface: 'legacy.chase.enabled', hits90d: 0 }]);
  assert.deepEqual(report, [{ surface: 'legacy.chase.enabled', class: 'unused', hits: 0 }]);
});

test('buildIdentifyUnusedReport: seldom-few-hits-02 shape, hit count preserved', () => {
  const report = buildIdentifyUnusedReport([{ surface: '/old-sweep', hits90d: 2 }]);
  assert.deepEqual(report, [{ surface: '/old-sweep', class: 'seldom', hits: 2 }]);
});

test('buildIdentifyUnusedReport: active-surface-ignored-04 - an above-threshold surface is omitted', () => {
  const report = buildIdentifyUnusedReport([{ surface: 'extension/src/bridge/residentPaneLive.ts', hits90d: 40 }]);
  assert.deepEqual(report, []);
});

test('buildIdentifyUnusedReport: sorted unused-first, ascending hits, then surface name', () => {
  const report = buildIdentifyUnusedReport([
    { surface: 'z-surface', hits90d: 1 },
    { surface: 'a-unused', hits90d: 0 },
    { surface: 'a-surface', hits90d: 1 },
    { surface: 'omitted', hits90d: 5 },
  ]);
  assert.deepEqual(
    report.map((c) => c.surface),
    ['a-unused', 'a-surface', 'z-surface']
  );
});

test('writePendingNotification: no candidates writes nothing', () => {
  const root = mkTmpDir('bl1186-nonotify-');
  const written = writePendingNotification(root, { generatedAtIso: '2026-08-28T00:00:00.000Z', ledgerAvailable: true, candidates: [] });
  assert.equal(written, null);
  assert.equal(fs.existsSync(path.join(root, '.swarmforge', 'deprecator', 'pending-notifications')), false);
});

test('writePendingNotification: candidates are queued as a human-visible file naming surface + class', () => {
  const root = mkTmpDir('bl1186-notify-');
  const report = {
    generatedAtIso: '2026-08-28T00:00:00.000Z',
    ledgerAvailable: true,
    candidates: [{ surface: 'legacy.chase.enabled', class: 'unused', hits: 0 }],
  };
  const written = writePendingNotification(root, report);
  assert.ok(written && fs.existsSync(written));
  const saved = JSON.parse(fs.readFileSync(written, 'utf8'));
  assert.deepEqual(saved, report);
});

test('runDeprecatorIdentifyUnusedScan: end-to-end, notify-human-only-03 - queues notification, touches nothing else', () => {
  const root = mkTmpDir('bl1186-e2e-');
  writeLedger(root, [
    { surface: 'legacy.chase.enabled', hits90d: 0 },
    { surface: '/old-sweep', hits90d: 2 },
    { surface: 'extension/src/bridge/residentPaneLive.ts', hits90d: 40 },
  ]);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-9999-untouched.yaml'), 'id: BL-9999\nstatus: todo\n');
  const before = fs.readFileSync(path.join(root, 'backlog', 'active', 'BL-9999-untouched.yaml'), 'utf8');

  const report = runDeprecatorIdentifyUnusedScan(root, '2026-08-28T12:00:00.000Z');

  assert.equal(report.ledgerAvailable, true);
  assert.deepEqual(report.candidates, [
    { surface: 'legacy.chase.enabled', class: 'unused', hits: 0 },
    { surface: '/old-sweep', class: 'seldom', hits: 2 },
  ]);

  const notifyDir = path.join(root, '.swarmforge', 'deprecator', 'pending-notifications');
  const files = fs.readdirSync(notifyDir);
  assert.equal(files.length, 1);
  const queued = JSON.parse(fs.readFileSync(path.join(notifyDir, files[0]), 'utf8'));
  assert.equal(queued.candidates.length, 2);

  // no ticket closed, no code removed, no config mutated
  assert.equal(fs.readFileSync(path.join(root, 'backlog', 'active', 'BL-9999-untouched.yaml'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'backlog', 'done')), false);
});

test('runDeprecatorIdentifyUnusedScan: no ledger fails open with an honest empty report, no notification', () => {
  const root = mkTmpDir('bl1186-noledger-e2e-');
  const report = runDeprecatorIdentifyUnusedScan(root, '2026-08-28T12:00:00.000Z');
  assert.equal(report.ledgerAvailable, false);
  assert.deepEqual(report.candidates, []);
  assert.equal(fs.existsSync(path.join(root, '.swarmforge', 'deprecator', 'pending-notifications')), false);
});
