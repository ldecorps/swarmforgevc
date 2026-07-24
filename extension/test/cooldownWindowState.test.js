const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  cooldownWindowMarkerPath,
  readCooldownWindowMarker,
  writeCooldownWindowMarker,
  readCooldownConfigFromDisk,
} = require('../out/tools/cooldownWindowState');

test('BL-617: readCooldownWindowMarker degrades to undefined when the marker is absent', () => {
  const root = mkTmpDir('bl617-marker-');
  assert.deepEqual(readCooldownWindowMarker(root), { lastHandledWindowStartMs: undefined });
});

test('BL-617: writeCooldownWindowMarker round-trips through readCooldownWindowMarker', () => {
  const root = mkTmpDir('bl617-marker-');
  writeCooldownWindowMarker(root, 12345);
  assert.deepEqual(readCooldownWindowMarker(root), { lastHandledWindowStartMs: 12345 });
  const onDisk = JSON.parse(fs.readFileSync(cooldownWindowMarkerPath(root), 'utf8'));
  assert.deepEqual(onDisk, { lastHandledWindowStartMs: 12345 });
});

test('BL-617: readCooldownWindowMarker degrades on corrupt JSON', () => {
  const root = mkTmpDir('bl617-marker-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(cooldownWindowMarkerPath(root), 'not json');
  assert.deepEqual(readCooldownWindowMarker(root), { lastHandledWindowStartMs: undefined });
});

test('BL-617: readCooldownConfigFromDisk degrades to disabled when swarmforge.conf is absent', () => {
  const root = mkTmpDir('bl617-conf-');
  const parsed = readCooldownConfigFromDisk(root);
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.config.enabled, false);
});

test('BL-617: readCooldownConfigFromDisk reads real conf lines', () => {
  const root = mkTmpDir('bl617-conf-');
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    'config cooldown_window_enabled true\nconfig cooldown_start_local 20:00\nconfig cooldown_end_local 06:00\n'
  );
  const parsed = readCooldownConfigFromDisk(root);
  assert.equal(parsed.malformed, false);
  assert.deepEqual(parsed.config, { enabled: true, startLocal: { hour: 20, minute: 0 }, endLocal: { hour: 6, minute: 0 } });
});
