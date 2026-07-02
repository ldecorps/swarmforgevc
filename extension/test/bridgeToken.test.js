const assert = require('node:assert/strict');
const test = require('node:test');
const { generateBridgeToken } = require('../out/bridge/bridgeToken');

test('generateBridgeToken returns a non-empty hex string', () => {
  const token = generateBridgeToken();
  assert.match(token, /^[0-9a-f]+$/);
  assert.ok(token.length >= 32, 'token should be long enough to resist guessing');
});

test('generateBridgeToken returns a different token on each call', () => {
  const a = generateBridgeToken();
  const b = generateBridgeToken();
  assert.notEqual(a, b);
});
