const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  webUiFontSizePreferencePath,
  readWebUiFontSizePreference,
  writeWebUiFontSizePreference,
  resolveWebUiFontSizePx,
  readWebUiTicketStripCollapsed,
  writeWebUiTicketStripCollapsed,
  resolveWebUiTicketStripCollapsed,
  isWebUiTicketStripCollapsedWriteRequestShape,
} = require('../out/bridge/webUiFontSizePreference');

function mkRoot() {
  return mkTmpDir('sfvc-web-ui-font-');
}

test('readWebUiFontSizePreference: no file yet reports none', () => {
  const root = mkRoot();
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'none' });
});

test('resolveWebUiFontSizePx: empty store returns each surface default exactly', () => {
  const root = mkRoot();
  assert.equal(resolveWebUiFontSizePx(root, 'live-screen'), 13);
  assert.equal(resolveWebUiFontSizePx(root, 'pipeline-grid'), 15);
  assert.equal(resolveWebUiFontSizePx(root, 'paused-pager'), 15);
});

test('writeWebUiFontSizePreference then read: round-trips per surface', () => {
  const root = mkRoot();
  const write = writeWebUiFontSizePreference(root, 'pipeline-grid', 18);
  assert.deepEqual(write, { ok: true, fontSizePx: 18 });
  assert.deepEqual(readWebUiFontSizePreference(root, 'pipeline-grid'), { kind: 'stored', fontSizePx: 18 });
  assert.deepEqual(readWebUiFontSizePreference(root, 'paused-pager'), { kind: 'none' });
});

test('writeWebUiFontSizePreference: clamps live-screen to its bounds', () => {
  const root = mkRoot();
  assert.deepEqual(writeWebUiFontSizePreference(root, 'live-screen', 99), { ok: true, fontSizePx: 20 });
  assert.deepEqual(writeWebUiFontSizePreference(root, 'live-screen', 5), { ok: true, fontSizePx: 9 });
});

test('writeWebUiFontSizePreference: clamps pipeline-grid to its bounds', () => {
  const root = mkRoot();
  assert.deepEqual(writeWebUiFontSizePreference(root, 'pipeline-grid', 99), { ok: true, fontSizePx: 26 });
});

test('resolveWebUiFontSizePx: corrupt JSON falls back to surface default', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), '{bad', 'utf8');
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'unreadable' });
  assert.equal(resolveWebUiFontSizePx(root, 'live-screen'), 13);
  assert.equal(resolveWebUiFontSizePx(root, 'pipeline-grid'), 15);
});

test('resolveWebUiFontSizePx: missing surface key falls back to default', () => {
  const root = mkRoot();
  writeWebUiFontSizePreference(root, 'pipeline-grid', 20);
  assert.equal(resolveWebUiFontSizePx(root, 'paused-pager'), 15);
});

test('readWebUiFontSizePreference: non-number surface value reports none', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), JSON.stringify({ 'live-screen': 'big' }), 'utf8');
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'none' });
  assert.equal(resolveWebUiFontSizePx(root, 'live-screen'), 13);
});

// ── BL-1542: ticket-strip collapse preference, beside fontSizePx ────────

test('readWebUiTicketStripCollapsed: no file yet reports none', () => {
  const root = mkRoot();
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'none' });
});

test('resolveWebUiTicketStripCollapsed: no stored preference defaults to expanded (false)', () => {
  const root = mkRoot();
  assert.equal(resolveWebUiTicketStripCollapsed(root, 'live-screen'), false);
});

test('writeWebUiTicketStripCollapsed then read: round-trips per surface', () => {
  const root = mkRoot();
  const write = writeWebUiTicketStripCollapsed(root, 'live-screen', true);
  assert.deepEqual(write, { ok: true, collapsed: true });
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'stored', collapsed: true });
  assert.equal(resolveWebUiTicketStripCollapsed(root, 'live-screen'), true);
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'pipeline-grid'), { kind: 'none' });
});

test('writeWebUiTicketStripCollapsed: rejects a non-boolean collapsed value', () => {
  const root = mkRoot();
  assert.deepEqual(writeWebUiTicketStripCollapsed(root, 'live-screen', 'yes'), {
    ok: false,
    reason: 'collapsed must be a boolean',
  });
});

test('a font-size write preserves an already-stored collapse preference (sibling keys, one store)', () => {
  const root = mkRoot();
  writeWebUiTicketStripCollapsed(root, 'live-screen', true);
  writeWebUiFontSizePreference(root, 'live-screen', 18);
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'stored', collapsed: true });
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'stored', fontSizePx: 18 });
});

test('a collapse write preserves an already-stored font-size preference (sibling keys, one store)', () => {
  const root = mkRoot();
  writeWebUiFontSizePreference(root, 'live-screen', 18);
  writeWebUiTicketStripCollapsed(root, 'live-screen', true);
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'stored', fontSizePx: 18 });
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'stored', collapsed: true });
});

test('the collapse preference lives in the SAME file as fontSizePx - no second file created', () => {
  const root = mkRoot();
  writeWebUiTicketStripCollapsed(root, 'live-screen', true);
  const dir = path.dirname(webUiFontSizePreferencePath(root));
  assert.deepEqual(fs.readdirSync(dir), [path.basename(webUiFontSizePreferencePath(root))]);
});

test('readWebUiTicketStripCollapsed: corrupt JSON reports unreadable', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), '{bad', 'utf8');
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'unreadable' });
  assert.equal(resolveWebUiTicketStripCollapsed(root, 'live-screen'), false);
});

test('isWebUiTicketStripCollapsedWriteRequestShape: accepts the exact shape, rejects everything else', () => {
  assert.equal(isWebUiTicketStripCollapsedWriteRequestShape({ surface: 'live-screen', collapsed: true }), true);
  assert.equal(isWebUiTicketStripCollapsedWriteRequestShape({ surface: 'live-screen', collapsed: 'true' }), false);
  assert.equal(isWebUiTicketStripCollapsedWriteRequestShape({ surface: 'not-a-surface', collapsed: true }), false);
  assert.equal(isWebUiTicketStripCollapsedWriteRequestShape(null), false);
  assert.equal(isWebUiTicketStripCollapsedWriteRequestShape([]), false);
});
