const assert = require('node:assert/strict');
const {
  sendTelegramMessage,
  getTelegramUpdates,
  createForumTopic,
  closeForumTopic,
  reopenForumTopic,
  deleteForumTopic,
  editForumTopic,
  editForumTopicWithRateLimitRetry,
  getForumTopicIconStickers,
  answerCallbackQuery,
} = require('../out/notify/telegramClient');

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

// ── BL-410: inline-keyboard buttons + answerCallbackQuery ────────────────

test('sendTelegramMessage attaches reply_markup.inline_keyboard when buttons are given, translating callbackData to callback_data', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: { ok: true, result: { message_id: 46 } } };
  };

  await sendTelegramMessage(TOKEN, CHAT_ID, 'needs your approval', undefined, postFn, 7, [
    [
      { text: 'Approve', callbackData: 'approve:BL-410' },
      { text: 'Amend', callbackData: 'amend:BL-410' },
      { text: 'Reject', callbackData: 'reject:BL-410' },
    ],
  ]);

  assert.deepEqual(JSON.parse(capturedBody), {
    chat_id: CHAT_ID,
    text: 'needs your approval',
    message_thread_id: 7,
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Approve', callback_data: 'approve:BL-410' },
          { text: 'Amend', callback_data: 'amend:BL-410' },
          { text: 'Reject', callback_data: 'reject:BL-410' },
        ],
      ],
    },
  });
});

test('sendTelegramMessage omits reply_markup entirely when no buttons are given (existing callers unaffected)', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: { ok: true, result: { message_id: 47 } } };
  };

  await sendTelegramMessage(TOKEN, CHAT_ID, 'no buttons', undefined, postFn, 7);

  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(capturedBody), 'reply_markup'), false);
});

test('answerCallbackQuery posts the callback_query_id to the Telegram API and reports success', async () => {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const result = await answerCallbackQuery(TOKEN, 'cbq-1', postFn);

  assert.deepEqual(result, { success: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`);
  assert.deepEqual(JSON.parse(calls[0].body), { callback_query_id: 'cbq-1' });
});

test('answerCallbackQuery reports failure on a non-2xx response without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'query is too old' } });

  const result = await answerCallbackQuery(TOKEN, 'cbq-2', postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /query is too old/);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
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

// BL-444: "group chat was upgraded to a supergroup chat" carries the new id
// in parameters.migrate_to_chat_id - a REDIRECT the caller should follow,
// not an ordinary opaque failure.
test('BL-444: createForumTopic surfaces migrateToChatId from a "upgraded to a supergroup" failure', async () => {
  const postFn = async () => ({
    ok: false,
    status: 400,
    json: { ok: false, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: -1003886489685 } },
  });

  const result = await createForumTopic(TOKEN, CHAT_ID, 'Contract negotiation', postFn);

  assert.equal(result.success, false);
  assert.equal(result.migrateToChatId, -1003886489685);
  assert.match(result.error, /upgraded to a supergroup/);
});

test('BL-444: createForumTopic leaves migrateToChatId undefined for an ordinary (non-migration) failure', async () => {
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'Topics are not enabled' } });

  const result = await createForumTopic(TOKEN, CHAT_ID, 'billing question', postFn);

  assert.equal(result.migrateToChatId, undefined);
});

// ── BL-342: createForumTopic's own optional icon at creation time ───────

test('BL-342: createForumTopic includes icon_custom_emoji_id in the request body when given', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 9 } } };
  };

  await createForumTopic(TOKEN, CHAT_ID, 'BL-900 - a fine feature', postFn, 'icon-abc');

  assert.deepEqual(JSON.parse(capturedBody), { chat_id: CHAT_ID, name: 'BL-900 - a fine feature', icon_custom_emoji_id: 'icon-abc' });
});

test('BL-342: createForumTopic omits icon_custom_emoji_id entirely when not given (existing callers unaffected)', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: { ok: true, result: { message_thread_id: 9 } } };
  };

  await createForumTopic(TOKEN, CHAT_ID, 'BL-900 - a fine feature', postFn);

  assert.deepEqual(JSON.parse(capturedBody), { chat_id: CHAT_ID, name: 'BL-900 - a fine feature' });
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

test('BL-332: reopenForumTopic posts to the Telegram API with the topic\'s message_thread_id and reports success', async () => {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const result = await reopenForumTopic(TOKEN, CHAT_ID, 7, postFn);

  assert.deepEqual(result, { success: true });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/reopenForumTopic`);
  assert.deepEqual(JSON.parse(calls[0].body), { chat_id: CHAT_ID, message_thread_id: 7 });
});

test('BL-332: reopenForumTopic reports failure on a non-2xx response without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'topic not found' } });

  const result = await reopenForumTopic(TOKEN, CHAT_ID, 7, postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /topic not found/);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

test('BL-332: reopenForumTopic reports a redacted failure on a thrown network error', async () => {
  const postFn = async () => {
    throw new Error(`connection reset while calling bot${TOKEN}`);
  };

  const result = await reopenForumTopic(TOKEN, CHAT_ID, 7, postFn);

  assert.equal(result.success, false);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

test('BL-331: deleteForumTopic posts to the Telegram API with the topic\'s message_thread_id and reports success', async () => {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const result = await deleteForumTopic(TOKEN, CHAT_ID, 7, postFn);

  assert.deepEqual(result, { success: true });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/deleteForumTopic`);
  assert.deepEqual(JSON.parse(calls[0].body), { chat_id: CHAT_ID, message_thread_id: 7 });
});

test('BL-331: deleteForumTopic reports failure on a non-2xx response without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'topic not found' } });

  const result = await deleteForumTopic(TOKEN, CHAT_ID, 7, postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /topic not found/);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

test('BL-331: deleteForumTopic reports a redacted failure on a thrown network error', async () => {
  const postFn = async () => {
    throw new Error(`connection reset while calling bot${TOKEN}`);
  };

  const result = await deleteForumTopic(TOKEN, CHAT_ID, 7, postFn);

  assert.equal(result.success, false);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

// ── BL-342: editForumTopic - the wrapper the intake assumed existed ─────

test('BL-342: editForumTopic posts name/icon updates with the topic\'s message_thread_id and reports success', async () => {
  const calls = [];
  const postFn = async (url, body) => {
    calls.push({ url, body });
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  const result = await editForumTopic(TOKEN, CHAT_ID, 7, { iconCustomEmojiId: 'icon-abc' }, postFn);

  assert.deepEqual(result, { success: true });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/editForumTopic`);
  assert.deepEqual(JSON.parse(calls[0].body), { chat_id: CHAT_ID, message_thread_id: 7, icon_custom_emoji_id: 'icon-abc' });
});

test('BL-342: editForumTopic includes name when given, alongside or instead of the icon', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };

  await editForumTopic(TOKEN, CHAT_ID, 7, { name: 'BL-900 - renamed' }, postFn);

  assert.deepEqual(JSON.parse(capturedBody), { chat_id: CHAT_ID, message_thread_id: 7, name: 'BL-900 - renamed' });
});

test('BL-342: editForumTopic reports failure on a non-2xx response without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'topic not found' } });

  const result = await editForumTopic(TOKEN, CHAT_ID, 7, { iconCustomEmojiId: 'icon-abc' }, postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /topic not found/);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

test('BL-342: editForumTopic reports a redacted failure on a thrown network error', async () => {
  const postFn = async () => {
    throw new Error(`connection reset while calling bot${TOKEN}`);
  };

  const result = await editForumTopic(TOKEN, CHAT_ID, 7, { iconCustomEmojiId: 'icon-abc' }, postFn);

  assert.equal(result.success, false);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});

// BL-342: the Operator's own real repro - 26 icon-set calls hit "Too Many
// Requests: retry after 26" after 19 calls and 7 were silently dropped.
// editForumTopic must surface retry_after so a caller can honour it,
// rather than treating a 429 as an ordinary opaque failure.
test('BL-342: editForumTopic surfaces retryAfterSeconds from a 429 rate-limit response', async () => {
  const postFn = async () => ({
    ok: false,
    status: 429,
    json: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 26', parameters: { retry_after: 26 } },
  });

  const result = await editForumTopic(TOKEN, CHAT_ID, 7, { iconCustomEmojiId: 'icon-abc' }, postFn);

  assert.equal(result.success, false);
  assert.equal(result.retryAfterSeconds, 26);
});

test('BL-342: editForumTopic leaves retryAfterSeconds undefined for an ordinary (non-429) failure', async () => {
  const postFn = async () => ({ ok: false, status: 400, json: { ok: false, description: 'topic not found' } });

  const result = await editForumTopic(TOKEN, CHAT_ID, 7, { iconCustomEmojiId: 'icon-abc' }, postFn);

  assert.equal(result.retryAfterSeconds, undefined);
});

// ── BL-414 hardener bounce: editForumTopicWithRateLimitRetry - the shared
//    retry-loop generalization of backfill-topic-icons.ts's own
//    setTopicIconWithRateLimitRetry (BL-342), so a NAME edit (title-age
//    sync) can honour a 429's retry_after the same way an ICON edit (the
//    backfill) already does. Mirrors that file's own test shapes exactly.

test('BL-414: editForumTopicWithRateLimitRetry waits exactly retry_after seconds and retries the SAME topic on a 429', async () => {
  let calls = 0;
  const postFn = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 429, json: { ok: false, description: 'Too Many Requests: retry after 26', parameters: { retry_after: 26 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };
  const waits = [];

  const result = await editForumTopicWithRateLimitRetry(TOKEN, CHAT_ID, 101, { name: 'BL-900 - renamed' }, async (ms) => waits.push(ms), postFn);

  assert.equal(result, true);
  assert.equal(calls, 2, 'expected the rate-limited call to be retried, never dropped');
  assert.deepEqual(waits, [26000], 'expected the wait to be EXACTLY retry_after seconds, in ms, never a generic guess');
});

test('BL-414: editForumTopicWithRateLimitRetry keeps retrying through MULTIPLE consecutive rate-limit responses until it succeeds', async () => {
  let calls = 0;
  const postFn = async () => {
    calls += 1;
    if (calls <= 3) {
      return { ok: false, status: 429, json: { ok: false, description: 'retry after 5', parameters: { retry_after: 5 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };
  const waits = [];

  const result = await editForumTopicWithRateLimitRetry(TOKEN, CHAT_ID, 101, { name: 'BL-900 - renamed' }, async (ms) => waits.push(ms), postFn);

  assert.equal(result, true);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [5000, 5000, 5000]);
});

test('BL-414: editForumTopicWithRateLimitRetry does NOT retry a genuine (non-429) failure - returns false immediately', async () => {
  let calls = 0;
  const postFn = async () => {
    calls += 1;
    return { ok: false, status: 400, json: { ok: false, description: 'topic not found' } };
  };
  const waits = [];

  const result = await editForumTopicWithRateLimitRetry(TOKEN, CHAT_ID, 101, { name: 'BL-900 - renamed' }, async (ms) => waits.push(ms), postFn);

  assert.equal(result, false);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

// ── BL-342: getForumTopicIconStickers - the validated set icon ids must
//    be resolved against, never a hardcoded id (scenario 06) ─────────────

test('BL-342: getForumTopicIconStickers returns the sticker list with custom_emoji_id and emoji', async () => {
  const postFn = async () => ({
    ok: true,
    status: 200,
    json: {
      ok: true,
      result: [
        { width: 100, height: 100, emoji: '✅', custom_emoji_id: 'icon-check' },
        { width: 100, height: 100, emoji: '🐛', custom_emoji_id: 'icon-bug' },
      ],
    },
  });

  const result = await getForumTopicIconStickers(TOKEN, postFn);

  assert.equal(result.success, true);
  assert.deepEqual(result.stickers, [
    { emoji: '✅', customEmojiId: 'icon-check' },
    { emoji: '🐛', customEmojiId: 'icon-bug' },
  ]);
});

test('BL-342: getForumTopicIconStickers reports failure on a non-2xx response without leaking the token', async () => {
  const postFn = async () => ({ ok: false, status: 500, json: { ok: false, description: 'internal error' } });

  const result = await getForumTopicIconStickers(TOKEN, postFn);

  assert.equal(result.success, false);
  assert.deepEqual(result.stickers, []);
  assert.doesNotMatch(result.error, new RegExp(TOKEN));
});
