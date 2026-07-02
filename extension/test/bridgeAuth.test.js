const assert = require('node:assert/strict');
const test = require('node:test');
const { isAuthorizedRequest } = require('../out/bridge/bridgeAuth');

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

test('isAuthorizedRequest rejects a header missing the Bearer prefix', () => {
  assert.equal(isAuthorizedRequest(TOKEN, TOKEN), false);
});

test('isAuthorizedRequest rejects an empty token value', () => {
  assert.equal(isAuthorizedRequest('Bearer ', TOKEN), false);
});
