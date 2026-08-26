const assert = require('node:assert/strict');
const { createNullMtEngine, createDeeplEngine } = require('../out/i18n/mtEngine');

test('the null engine always fails, never throws - the no-API-key-configured default', async () => {
  const engine = createNullMtEngine();
  const result = await engine.translate('hello', 'fr');
  assert.equal(result.success, false);
});

test('createDeeplEngine posts the text and target language, returning the translated text on success', async () => {
  let capturedUrl, capturedBody, capturedKey;
  const postFn = async (url, body, apiKey) => {
    capturedUrl = url;
    capturedBody = body;
    capturedKey = apiKey;
    return { ok: true, status: 200, json: async () => ({ translations: [{ text: 'bonjour' }] }) };
  };
  const engine = createDeeplEngine('test-key', postFn);

  const result = await engine.translate('hello', 'fr');

  assert.deepEqual(result, { success: true, text: 'bonjour' });
  assert.match(capturedUrl, /deepl/);
  assert.equal(capturedKey, 'test-key');
  const parsedBody = JSON.parse(capturedBody);
  assert.deepEqual(parsedBody.text, ['hello']);
  assert.equal(parsedBody.target_lang, 'FR');
});

// BL-230: always sends DeepL's own tag_handling/ignore_tags params, so
// <jargon>...</jargon>-wrapped tokens (jargonPreserve.ts) pass through
// untranslated regardless of what text is sent - a no-op when the text has
// no such tags.
test('createDeeplEngine always requests xml tag_handling with jargon tags ignored', async () => {
  let capturedBody;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: async () => ({ translations: [{ text: 'bonjour' }] }) };
  };
  const engine = createDeeplEngine('test-key', postFn);

  await engine.translate('hello', 'fr');

  const parsedBody = JSON.parse(capturedBody);
  assert.equal(parsedBody.tag_handling, 'xml');
  assert.deepEqual(parsedBody.ignore_tags, ['jargon']);
});

test('a non-ok HTTP response fails with the status code, not a thrown exception', async () => {
  const postFn = async () => ({ ok: false, status: 429, json: async () => ({}) });
  const engine = createDeeplEngine('test-key', postFn);

  const result = await engine.translate('hello', 'fr');

  assert.equal(result.success, false);
  assert.match(result.error, /429/);
});

test('a malformed response body (missing translations) fails cleanly rather than throwing', async () => {
  const postFn = async () => ({ ok: true, status: 200, json: async () => ({ unexpected: 'shape' }) });
  const engine = createDeeplEngine('test-key', postFn);

  const result = await engine.translate('hello', 'fr');

  assert.equal(result.success, false);
});

test('a postFn that throws is caught and the API key is redacted from the error text', async () => {
  const postFn = async () => {
    throw new Error('connection failed for key super-secret-key-value');
  };
  const engine = createDeeplEngine('super-secret-key-value', postFn);

  const result = await engine.translate('hello', 'fr');

  assert.equal(result.success, false);
  assert.doesNotMatch(result.error, /super-secret-key-value/);
  assert.match(result.error, /\[redacted\]/);
});
