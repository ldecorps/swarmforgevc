const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCliTranslationSession, persistCliTranslationSession } = require('../out/i18n/cliSession');
const { translationCacheFile } = require('../out/i18n/translationCache');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-cli-session-'));
}

test('with no MT_API_KEY set, createCliTranslationSession falls back to an engine that always fails (never throws)', async () => {
  const original = process.env.MT_API_KEY;
  delete process.env.MT_API_KEY;
  try {
    const target = mkTmp();
    const session = createCliTranslationSession(target);
    const result = await session.engine.translate('hello', 'fr');
    assert.equal(result.success, false);
  } finally {
    if (original !== undefined) process.env.MT_API_KEY = original;
  }
});

test('createCliTranslationSession loads whatever cache already exists on disk', () => {
  const target = mkTmp();
  const file = translationCacheFile(target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, entries: { abc: 'bonjour' } }));

  const session = createCliTranslationSession(target);

  assert.equal(session.cache.entries.abc, 'bonjour');
});

test('persistCliTranslationSession writes the session cache back to disk', () => {
  const target = mkTmp();
  const session = createCliTranslationSession(target);
  session.cache.entries.newhash = 'nouveau';

  persistCliTranslationSession(target, session);

  const written = JSON.parse(fs.readFileSync(translationCacheFile(target), 'utf-8'));
  assert.equal(written.entries.newhash, 'nouveau');
});
