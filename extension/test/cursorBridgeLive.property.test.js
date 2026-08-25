const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  inboundEventOf,
  loadTopicMap,
} = require('../out/tools/telegramCursorBridgeLive');
const { decideInboundAction, gateBusy, splitTelegramChunks } = require('../out/tools/telegramCursorBridgeCore');

test('property: inboundEventOf never invents fields when message is incomplete', () => {
  fc.assert(
    fc.property(fc.record({ update_id: fc.nat() }), (update) => {
      const event = inboundEventOf(update);
      assert.equal(event, undefined);
    }),
    { numRuns: 40 }
  );
});

test('property: loadTopicMap always returns a plain object', () => {
  fc.assert(
    fc.property(fc.oneof(fc.constant('{}'), fc.constant('[]'), fc.constant('null'), fc.string()), (raw) => {
      const root = mkTmpDir('sfvc-prop-map-');
      const filePath = path.join(root, 'map.json');
      fs.writeFileSync(filePath, raw);
      const map = loadTopicMap(filePath);
      assert.equal(typeof map, 'object');
      assert.ok(map !== null);
      assert.ok(!Array.isArray(map));
    }),
    { numRuns: 30 }
  );
});

test('property: gateBusy never upgrades ignore to prompt while busy', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 40 }), (suffix) => {
      const text = `please remember ${suffix}`;
      const inbound = { fromId: 1, chatId: '-100', topicId: 9, text };
      const decision = decideInboundAction(inbound, '1', '-100', 9);
      if (decision.action === 'prompt') {
        assert.equal(gateBusy(decision, true).action, 'busy');
      }
    }),
    { numRuns: 60 }
  );
});

test('property: splitTelegramChunks reassembles without loss for short strings', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 200 }), (text) => {
      const chunks = splitTelegramChunks(text);
      assert.equal(chunks.join(''), text);
    }),
    { numRuns: 80 }
  );
});
