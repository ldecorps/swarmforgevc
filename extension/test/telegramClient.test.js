const assert = require('node:assert/strict');
const { sendTelegramMessage, getTelegramUpdates, createForumTopic, closeForumTopic } = require('../out/notify/telegramClient');

const TOKEN = '123456:test-bot-token';
const CHAT_ID = '999888777';

test('sendTelegramMessage posts to the Telegram API and reports success with the new message id', async () => {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: { message_id: 42 } } };
  };

  const result = await sendTelegramMessage(TOKEN, CHAT_ID, 'coder is idle -> active', undefined, postFn);

  assert.deepEqual(result, { success: true, messageId: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  const parsed = JSON.parse(calls[0].body);
  assert.deepEqual(parsed, { chat_id: CHAT_ID, text: 'coder is idle -> active' });
});

test('sendTelegramMessage includes reply_to_message_id when threading into an existing run', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: { ok: true, result: { message_id: 43 } } };
  };

  await sendTelegramMessage(TOKEN, CHAT_ID, 'PR ready: https://example.com/pr/1', 42, postFn);

  assert.deepEqual(JSON.parse(capturedBody), {
    chat_id: CHAT_ID,
    text: 'PR ready: https://example.com/pr/1',
    reply_to_message_id: 42,
  });
});

test('sendTelegramMessage reports failure on a non-2xx response without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 401, json: { ok: false, description: 'Unauthorized' } });

  const result = await sendTelegramMessage(TOKEN, CHAT_ID, 'hi', undefined, postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /401/);
  assert.match(result.error, /Unauthorized/);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

test('sendTelegramMessage catches a thrown/network error and redacts the token even if the error text echoes it', async () => {
  const postFn = async () => {
    throw new Error(`ECONNREFUSED for https://api.telegram.org/bot${TOKEN}/sendMessage`);
  };

  const result = await sendTelegramMessage(TOKEN, CHAT_ID, 'hi', undefined, postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /ECONNREFUSED/);
  assert.doesNotMatch(result.error, new RegExp(TOKEN), 'the token must be redacted even out of an arbitrary thrown error message');
  assert.match(result.error, /\[redacted\]/);
});

test('getTelegramUpdates returns the update batch from a successful poll', async () => {
  const updates = [{ update_id: 5, message: { message_id: 7, chat: { id: 999888777 }, text: 'yes' } }];
  const postFn = async (url, body) => {
    assert.equal(url, `https://api.telegram.org/bot${TOKEN}/getUpdates`);
    assert.deepEqual(JSON.parse(body), { offset: 6, timeout: 25 });
    return { ok: true, status: 200, json: { ok: true, result: updates } };
  };

  const result = await getTelegramUpdates(TOKEN, 6, 25, postFn);

  assert.deepEqual(result, { success: true, updates });
});

test('getTelegramUpdates reports failure without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 404, json: { ok: false, description: 'Not Found' } });

  const result = await getTelegramUpdates(TOKEN, 0, 25, postFn);

  assert.equal(result.success, false);
  assert.deepEqual(result.updates, []);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

// ── BL-281: forum-topic support ──────────────────────────────────────────

test('sendTelegramMessage includes message_thread_id when replying into a forum topic', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: { ok: true, result: { message_id: 44 } } };
  };

  await sendTelegramMessage(TOKEN, CHAT_ID, 'reply in topic', undefined, postFn, 7);

  assert.deepEqual(JSON.parse(capturedBody), {
    chat_id: CHAT_ID,
    text: 'reply in topic',
    message_thread_id: 7,
  });
});

test('sendTelegramMessage omits message_thread_id entirely when not given (existing callers unaffected)', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: { ok: true, result: { message_id: 45 } } };
  };

  await sendTelegramMessage(TOKEN, CHAT_ID, 'no topic', undefined, postFn);

  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(capturedBody), 'message_thread_id'), false);
});

test('createForumTopic posts to the Telegram API and reports the new topic\'s message_thread_id', async () => {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 7, name: 'billing question' } } };
  };

  const result = await createForumTopic(TOKEN, CHAT_ID, 'billing question', postFn);

  assert.deepEqual(result, { success: true, messageThreadId: 7 });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/createForumTopic`);
  assert.deepEqual(JSON.parse(calls[0].body), { chat_id: CHAT_ID, name: 'billing question' });
});

test('createForumTopic reports failure on a non-2xx response without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'Topics are not enabled' } });

  const result = await createForumTopic(TOKEN, CHAT_ID, 'billing question', postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /Topics are not enabled/);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

test('BL-299: closeForumTopic posts to the Telegram API with the topic\'s message_thread_id and reports success', async () => {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const result = await closeForumTopic(TOKEN, CHAT_ID, 7, postFn);

  assert.deepEqual(result, { success: true });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/closeForumTopic`);
  assert.deepEqual(JSON.parse(calls[0].body), { chat_id: CHAT_ID, message_thread_id: 7 });
});

test('BL-299: closeForumTopic reports failure on a non-2xx response without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'topic already closed' } });

  const result = await closeForumTopic(TOKEN, CHAT_ID, 7, postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /topic already closed/);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});
