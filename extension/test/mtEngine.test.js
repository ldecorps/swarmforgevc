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
