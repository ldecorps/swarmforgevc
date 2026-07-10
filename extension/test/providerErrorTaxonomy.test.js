const assert = require('node:assert/strict');
const { classifyProviderError } = require('../out/swarm/providerErrorTaxonomy');

// BL-207 normalize-01: provider-specific failures map to a stable category,
// with the original backend detail attached as context.
test('BL-207 normalize-01: a launch failure maps to launch-failed, detail attached', () => {
  const result = classifyProviderError('No launch script found for role "coder" at /path/coder.sh');
  assert.equal(result.category, 'launch-failed');
  assert.equal(result.detail, 'No launch script found for role "coder" at /path/coder.sh');
});

test('a missing tmux socket maps to launch-failed', () => {
  const result = classifyProviderError('Cannot respawn "coder": no tmux socket recorded (is the swarm running?)');
  assert.equal(result.category, 'launch-failed');
});

test('a rate-limit message maps to unavailable', () => {
  const result = classifyProviderError('429 Too Many Requests - rate limit exceeded');
  assert.equal(result.category, 'unavailable');
});

test('a service-overloaded message maps to unavailable', () => {
  const result = classifyProviderError('Service unavailable, please retry later');
  assert.equal(result.category, 'unavailable');
});

test('a malformed-JSON message maps to protocol', () => {
  const result = classifyProviderError('Unexpected token < in JSON at position 0');
  assert.equal(result.category, 'protocol');
});

test('a timeout message maps to timeout', () => {
  const result = classifyProviderError('Timed out waiting for swarm to become ready.');
  assert.equal(result.category, 'timeout');
});

test('a Node ETIMEDOUT code maps to timeout even with an unrelated message', () => {
  const result = classifyProviderError('connect failed', 'ETIMEDOUT');
  assert.equal(result.category, 'timeout');
});

// BL-207 cross-provider-parity-02: the SAME failure class from different
// providers (different exact wording) maps to the SAME category.
test('BL-207 cross-provider-parity-02: two differently-worded auth failures from different providers map to the same category', () => {
  const claudeStyle = classifyProviderError('Error: 401 Unauthorized - invalid API key provided');
  const aiderStyle = classifyProviderError('Authentication failed: invalid credential for this account');
  assert.equal(claudeStyle.category, 'auth');
  assert.equal(aiderStyle.category, 'auth');
  assert.equal(claudeStyle.category, aiderStyle.category);
});

test('two differently-worded rate-limit failures from different providers map to the same category', () => {
  const providerA = classifyProviderError('429 rate limit exceeded, back off and retry');
  const providerB = classifyProviderError('Request overloaded the service, try again shortly');
  assert.equal(providerA.category, providerB.category);
  assert.equal(providerA.category, 'unavailable');
});

// BL-207 unknown-fallback-03: an unmapped backend error becomes "unknown"
// with its raw detail attached, never a crash.
test('BL-207 unknown-fallback-03: an unrecognized error falls back to unknown with detail attached, never throws', () => {
  assert.doesNotThrow(() => classifyProviderError('some entirely novel provider-specific gibberish xyz123'));
  const result = classifyProviderError('some entirely novel provider-specific gibberish xyz123');
  assert.equal(result.category, 'unknown');
  assert.equal(result.detail, 'some entirely novel provider-specific gibberish xyz123');
});

test('empty/falsy detail never throws and falls back to unknown', () => {
  assert.doesNotThrow(() => classifyProviderError(''));
  assert.equal(classifyProviderError('').category, 'unknown');
});

// Closed set: every category the classifier can ever return is one of the
// six enumerated values - guards against a typo'd category name silently
// becoming a new, unenumerated one.
test('the classifier only ever returns one of the six enumerated categories', () => {
  const allowed = new Set(['launch-failed', 'auth', 'unavailable', 'protocol', 'timeout', 'unknown']);
  const samples = [
    'No launch script found',
    '401 unauthorized',
    '429 too many requests',
    'unexpected token in JSON',
    'timed out',
    'totally unrecognized text',
  ];
  for (const sample of samples) {
    assert.ok(allowed.has(classifyProviderError(sample).category), `unexpected category for "${sample}"`);
  }
});
