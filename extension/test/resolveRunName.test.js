/**
 * BL-024: resolveRunName — unit tests (written before implementation).
 */
const assert = require('node:assert/strict');
const { resolveRunName, generateDefaultRunName } = require('../out/run/resolveRunName');

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

// ── generateDefaultRunName (BL-352: moved out of extension.ts so a
//    headless caller can generate the SAME timestamp-default shape) ──────

test('BL-352: generateDefaultRunName formats a fixed instant as run-YYYYMMDD-HHMM', () => {
  const result = generateDefaultRunName(new Date(2026, 6, 13, 9, 5));
  assert.equal(result, 'run-20260713-0905');
});

test('BL-352: generateDefaultRunName defaults to the current time when no instant is given', () => {
  const before = new Date();
  const result = generateDefaultRunName();
  assert.match(result, /^run-\d{8}-\d{4}$/);
  const year = String(before.getFullYear());
  assert.ok(result.includes(year), `expected the current year in the default name, got: ${result}`);
});
