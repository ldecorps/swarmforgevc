const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  hashSourceText,
  readTranslationCache,
  writeTranslationCache,
  translationCacheFile,
} = require('../out/i18n/translationCache');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-i18n-cache-'));
}

test('hashSourceText is deterministic for the same input', () => {
  assert.equal(hashSourceText('hello world'), hashSourceText('hello world'));
});

test('hashSourceText differs for different input', () => {
  assert.notEqual(hashSourceText('hello'), hashSourceText('hellO'));
});

test('translationCacheFile lives under docs/i18n/, committed to the repo (not .swarmforge/)', () => {
  const file = translationCacheFile('/repo');
  assert.equal(file, path.join('/repo', 'docs', 'i18n', 'translation-cache.json'));
});

test('readTranslationCache returns an empty cache when no file exists yet', () => {
  const target = mkTmp();
  const cache = readTranslationCache(target);
  assert.deepEqual(cache.entries, {});
});

test('writeTranslationCache then readTranslationCache round-trips the same data', () => {
  const target = mkTmp();
  const cache = { schemaVersion: 1, entries: { abc123: 'bonjour' } };
  writeTranslationCache(target, cache);
  assert.deepEqual(readTranslationCache(target), cache);
});

test('readTranslationCache recovers to empty instead of throwing on corrupt JSON', () => {
  const target = mkTmp();
  const file = translationCacheFile(target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not valid json{{{', 'utf-8');
  assert.deepEqual(readTranslationCache(target).entries, {});
});

test('readTranslationCache recovers to empty for a valid JSON value of the wrong shape', () => {
  const target = mkTmp();
  const file = translationCacheFile(target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([1, 2, 3]), 'utf-8');
  assert.deepEqual(readTranslationCache(target).entries, {});
});
