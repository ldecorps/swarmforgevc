const assert = require('node:assert/strict');
const { isAuthorizedRequest, isAuthorizedToken } = require('../out/bridge/bridgeAuth');

const TOKEN = 'abc123def456';

test('isAuthorizedRequest accepts the matching bearer token', () => {
  assert.equal(isAuthorizedRequest(`Bearer ${TOKEN}`, TOKEN), true);
});

test('isAuthorizedRequest rejects a missing header', () => {
  assert.equal(isAuthorizedRequest(undefined, TOKEN), false);
});

test('isAuthorizedRequest rejects a mismatched token', () => {
  assert.equal(isAuthorizedRequest('Bearer wrong-token', TOKEN), false);
});

test('isAuthorizedRequest rejects a same-length but different token', () => {
  // Same length as TOKEN so the length-mismatch shortcut cannot short-circuit
  // this — it must fail via the actual crypto.timingSafeEqual comparison.
  assert.equal(TOKEN.length, 'xyz789uvw012'.length);
  assert.equal(isAuthorizedRequest('Bearer xyz789uvw012', TOKEN), false);
});

test('isAuthorizedRequest rejects a header missing the Bearer prefix', () => {
  assert.equal(isAuthorizedRequest(TOKEN, TOKEN), false);
});

test('isAuthorizedRequest rejects an empty token value', () => {
  assert.equal(isAuthorizedRequest('Bearer ', TOKEN), false);
});

test('isAuthorizedToken accepts only the exact raw token', () => {
  assert.equal(isAuthorizedToken(TOKEN, TOKEN), true);
  assert.equal(isAuthorizedToken(undefined, TOKEN), false);
  assert.equal(isAuthorizedToken('wrong-token', TOKEN), false);
  assert.equal(isAuthorizedToken('xyz789uvw012', TOKEN), false);
});
