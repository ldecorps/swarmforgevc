/**
 * BL-024: resolveRunName — unit tests (written before implementation).
 */
const assert = require('node:assert/strict');
const { resolveRunName } = require('../out/run/resolveRunName');

const DEFAULT = 'swarm-20260630T120000z';

// promptEnabled=false → return defaultName (promptResult ignored)

test('promptEnabled=false returns defaultName regardless of promptResult', () => {
  const result = resolveRunName({ promptEnabled: false, promptResult: undefined, defaultName: DEFAULT });
  assert.equal(result, DEFAULT);
});

test('promptEnabled=false returns defaultName when promptResult is a string', () => {
  const result = resolveRunName({ promptEnabled: false, promptResult: 'my-name', defaultName: DEFAULT });
  assert.equal(result, DEFAULT);
});

// promptEnabled=true + cancel (undefined) → abort

test('promptEnabled=true + promptResult=undefined returns undefined (abort)', () => {
  const result = resolveRunName({ promptEnabled: true, promptResult: undefined, defaultName: DEFAULT });
  assert.equal(result, undefined);
});

// promptEnabled=true + blank → return defaultName

test('promptEnabled=true + promptResult="" returns defaultName', () => {
  const result = resolveRunName({ promptEnabled: true, promptResult: '', defaultName: DEFAULT });
  assert.equal(result, DEFAULT);
});

test('promptEnabled=true + promptResult whitespace-only returns defaultName', () => {
  const result = resolveRunName({ promptEnabled: true, promptResult: '   ', defaultName: DEFAULT });
  assert.equal(result, DEFAULT);
});

// promptEnabled=true + non-blank → return trimmed promptResult

test('promptEnabled=true + non-blank promptResult returns trimmed value', () => {
  const result = resolveRunName({ promptEnabled: true, promptResult: 'fix-auth-bug', defaultName: DEFAULT });
  assert.equal(result, 'fix-auth-bug');
});

test('promptEnabled=true + promptResult with surrounding whitespace returns trimmed value', () => {
  const result = resolveRunName({ promptEnabled: true, promptResult: '  my-run  ', defaultName: DEFAULT });
  assert.equal(result, 'my-run');
});
