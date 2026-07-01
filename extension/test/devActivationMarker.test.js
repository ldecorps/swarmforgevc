const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  maybeWriteActivationMarker,
  DEV_ACTIVATION_MARKER_FILENAME,
} = require('../out/devActivationMarker');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-marker-'));
}

// --- BL-058 robust-bounce-05: marker written only in development mode ---

test('development-mode activation writes a marker with timestamp and pid', () => {
  const dir = mkTmp();
  const now = new Date('2026-07-01T21:00:00Z');
  const markerPath = maybeWriteActivationMarker(true, dir, 4242, now);

  assert.equal(markerPath, path.join(dir, DEV_ACTIVATION_MARKER_FILENAME));
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(marker.activatedAt, '2026-07-01T21:00:00.000Z');
  assert.equal(marker.pid, 4242);
});

test('production-mode activation writes no marker file', () => {
  const dir = mkTmp();
  const markerPath = maybeWriteActivationMarker(false, dir, 4242, new Date());

  assert.equal(markerPath, null);
  assert.equal(
    fs.existsSync(path.join(dir, DEV_ACTIVATION_MARKER_FILENAME)),
    false,
    'normal activation must never drop marker files into the repo'
  );
});

test('a fresh dev activation overwrites the previous marker', () => {
  const dir = mkTmp();
  maybeWriteActivationMarker(true, dir, 1, new Date('2026-07-01T20:00:00Z'));
  maybeWriteActivationMarker(true, dir, 2, new Date('2026-07-01T21:00:00Z'));

  const marker = JSON.parse(
    fs.readFileSync(path.join(dir, DEV_ACTIVATION_MARKER_FILENAME), 'utf8')
  );
  assert.equal(marker.pid, 2);
  assert.equal(marker.activatedAt, '2026-07-01T21:00:00.000Z');
});

test('a marker write failure does not throw (activation must survive)', () => {
  const missingDir = path.join(mkTmp(), 'does', 'not', 'exist');
  let markerPath;
  assert.doesNotThrow(() => {
    markerPath = maybeWriteActivationMarker(true, missingDir, 1, new Date());
  });
  assert.equal(markerPath, null);
});
