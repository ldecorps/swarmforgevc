const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getLetsTalkBubbleConfig } = require('../out/bridge/letsTalkBubbleConfig');

// BL-864: voiceEngineSwitch gates the Bubble Settings voice-engine selector
// (BL-862 epic decision 4, "per the BL-765 remote-config shape"). This file
// only exercises the flag BL-864 needs; the rest of letsTalkBubbleConfig.ts
// (schemaVersion/revision/other features, the still-unbuilt BL-765 route)
// is out of scope here.

function mkOperatorDir() {
  const root = mkTmpDir('sfvc-lt-bubble-config-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function configPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'lets-talk-bubble-config.json');
}

test('getLetsTalkBubbleConfig: default (no file on disk) has voiceEngineSwitch on', () => {
  const root = mkOperatorDir();
  const config = getLetsTalkBubbleConfig(root, {});
  assert.equal(config.features.voiceEngineSwitch, true);
});

test('getLetsTalkBubbleConfig: an on-disk file can turn voiceEngineSwitch off', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    configPath(root),
    JSON.stringify({ schemaVersion: 1, revision: 'r1', features: { voiceEngineSwitch: false } })
  );
  const config = getLetsTalkBubbleConfig(root, {});
  assert.equal(config.features.voiceEngineSwitch, false);
});

test('getLetsTalkBubbleConfig: a non-boolean voiceEngineSwitch falls back to the default (on)', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    configPath(root),
    JSON.stringify({ schemaVersion: 1, revision: 'r1', features: { voiceEngineSwitch: 'yes' } })
  );
  const config = getLetsTalkBubbleConfig(root, {});
  assert.equal(config.features.voiceEngineSwitch, true);
});

test('getLetsTalkBubbleConfig: LETS_TALK_BUBBLE_CONFIG_DISABLED forces voiceEngineSwitch on (bundled default)', () => {
  const root = mkOperatorDir();
  fs.writeFileSync(
    configPath(root),
    JSON.stringify({ schemaVersion: 1, revision: 'r1', features: { voiceEngineSwitch: false } })
  );
  const config = getLetsTalkBubbleConfig(root, { LETS_TALK_BUBBLE_CONFIG_DISABLED: '1' });
  assert.equal(config.features.voiceEngineSwitch, true);
});
