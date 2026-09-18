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

// BL-1542 hardener: readTicketStripCollapsedMap/readFontSizeMap are
// internal (not exported) - exercised here through their public callers.

test('a malformed ticketStripCollapsed field (not an object) is treated as no stored preference, not a crash', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), JSON.stringify({ ticketStripCollapsed: 'not-an-object' }), 'utf8');
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'none' });
  assert.equal(resolveWebUiTicketStripCollapsed(root, 'live-screen'), false);
});

test('a ticketStripCollapsed field that is an ARRAY is treated as no stored preference', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), JSON.stringify({ ticketStripCollapsed: [] }), 'utf8');
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'none' });
});

// BL-1542 hardener: `typeof null === 'object'` in JS, so ONLY the explicit
// `raw === null` half of the guard catches a literal `null` value - the
// array test above and the string test below both go through the
// `typeof raw !== 'object'` half instead, so neither discriminates this
// specific disjunct.
test('a ticketStripCollapsed field that is literally null is treated as no stored preference', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), JSON.stringify({ ticketStripCollapsed: null }), 'utf8');
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'none' });
});

test('a non-boolean value inside a well-formed ticketStripCollapsed map is dropped for that surface only', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(
    webUiFontSizePreferencePath(root),
    JSON.stringify({ ticketStripCollapsed: { 'live-screen': 'yes', 'pipeline-grid': true } }),
    'utf8'
  );
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'live-screen'), { kind: 'none' });
  assert.deepEqual(readWebUiTicketStripCollapsed(root, 'pipeline-grid'), { kind: 'stored', collapsed: true });
});

test('writing a font size preserves an existing valid font size for another surface and drops a non-number one', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(
    webUiFontSizePreferencePath(root),
    JSON.stringify({ 'pipeline-grid': 20, 'paused-pager': 'not-a-number' }),
    'utf8'
  );
  writeWebUiFontSizePreference(root, 'live-screen', 15);
  assert.deepEqual(readWebUiFontSizePreference(root, 'pipeline-grid'), { kind: 'stored', fontSizePx: 20 });
  assert.deepEqual(readWebUiFontSizePreference(root, 'paused-pager'), { kind: 'none' });
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'stored', fontSizePx: 15 });
});

// BL-1542 hardener: `typeof raw === 'number' && Number.isFinite(raw)`
// (readFontSizeMap) - a mutant weakening `&&` to `||` is invisible to
// every non-number fixture above, because `typeof 'string' === 'number'`
// is false AND `Number.isFinite('string')` is also false (no coercion),
// so both operators agree. The discriminator needs a value that IS typeof
// 'number' but is NOT finite: `1e999` overflows to `Infinity` when
// JSON.parse reads it (valid JSON syntax, out-of-range value) - `typeof`
// is true, `Number.isFinite` is false, and only `&&` correctly drops it.
test('a stored font-size value that overflows to Infinity is dropped, not carried forward as a number', () => {
  const root = mkRoot();
  fs.mkdirSync(path.dirname(webUiFontSizePreferencePath(root)), { recursive: true });
  fs.writeFileSync(webUiFontSizePreferencePath(root), '{"pipeline-grid": 1e999}', 'utf8');
  writeWebUiFontSizePreference(root, 'live-screen', 15);
  assert.deepEqual(readWebUiFontSizePreference(root, 'pipeline-grid'), { kind: 'none' });
});

// BL-1542 hardener: writeWebUiFontSizePreference's own `!Number.isFinite`
// guard on its INCOMING argument (distinct from the stored-value guard
// above) had no direct test - pin both the refusal and its exact shape.
test('writeWebUiFontSizePreference refuses a non-finite fontSizePx argument and persists nothing', () => {
  const root = mkRoot();
  assert.deepEqual(writeWebUiFontSizePreference(root, 'live-screen', NaN), {
    ok: false,
    reason: 'fontSizePx must be a finite number',
  });
  assert.deepEqual(readWebUiFontSizePreference(root, 'live-screen'), { kind: 'none' });
});

// BL-1542 hardener: `Object.keys(collapsedMap).length > 0` guards writing
// the ticketStripCollapsed key at all - assert its ABSENCE (not merely an
// empty object) from the persisted file when no collapse preference has
// ever been set, distinguishing this from a mutant that always writes it.
test('writing a font size with no collapse preference ever set persists no ticketStripCollapsed key at all', () => {
  const root = mkRoot();
  writeWebUiFontSizePreference(root, 'live-screen', 15);
  const raw = JSON.parse(fs.readFileSync(webUiFontSizePreferencePath(root), 'utf8'));
  assert.ok(!('ticketStripCollapsed' in raw), `expected no ticketStripCollapsed key, got keys: ${Object.keys(raw)}`);
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
  assert.equal(isWebUiTicketStripCollapsedWriteRequestShape({}), false);
  assert.equal(isWebUiTicketStripCollapsedWriteRequestShape({ surface: 'live-screen' }), false);
});

// BL-1542 hardener: `undefined`, unlike `null`, is not caught by
// `value === null` - the guard's `typeof value !== 'object'` clause is
// what actually rejects it. A mutant neutralizing that clause makes
// `record.surface` throw on `undefined` (property access on `undefined`
// is NOT safe the way it is on a string/number/boolean primitive), so
// this is a real crash-preventing case, not the BL-799-style equivalence
// where the guard is redundant with a downstream `!value` check.
test('isWebUiTicketStripCollapsedWriteRequestShape: refuses undefined without throwing', () => {
  assert.equal(isWebUiTicketStripCollapsedWriteRequestShape(undefined), false);
});
