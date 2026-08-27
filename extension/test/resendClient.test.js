const assert = require('node:assert/strict');
const { sendResendEmail } = require('../out/notify/resendClient');

const MESSAGE = {
  to: 'human@example.com',
  from: 'onboarding@resend.dev',
  subject: 'SwarmForge: coder needs you',
  text: 'coder is waiting on a response.',
};

test('sendResendEmail posts to the Resend API and reports success on a 2xx response', async () => {
  const calls = [];
  const postFn = async (url, body, apiKey) => {
    calls.push({ url, body, apiKey });
    return { ok: true, status: 200 };
  };

  const result = await sendResendEmail('re_test_key', MESSAGE, postFn);

  assert.deepEqual(result, { success: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].apiKey, 're_test_key');
  const parsed = JSON.parse(calls[0].body);
  assert.deepEqual(parsed, {
    from: MESSAGE.from,
    to: [MESSAGE.to],
    subject: MESSAGE.subject,
    text: MESSAGE.text,
  });
});

test('sendResendEmail reports failure on a non-2xx response without leaking the key', async () => {
  const postFn = async () => ({ ok: false, status: 422 });

  const result = await sendResendEmail('re_super_secret', MESSAGE, postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /422/);
  assert.doesNotMatch(result.error, /re_super_secret/);
});

test('sendResendEmail catches a network/throw failure and reports it without leaking the key', async () => {
  // Deliberately simulates a thrown error whose message happens to contain
  // the key (a custom postFn, proxy, or future http client could echo
  // request details into a thrown message) — the result must still redact
  // it, since this flows straight into a logged output-channel line.
  const postFn = async () => {
    throw new Error('ECONNREFUSED for key re_super_secret');
  };

  const result = await sendResendEmail('re_super_secret', MESSAGE, postFn);

  assert.equal(result.success, false);
  assert.match(result.error, /ECONNREFUSED/);
  assert.doesNotMatch(result.error, /re_super_secret/, 'the key must be redacted even out of an arbitrary thrown error message');
  assert.match(result.error, /\[redacted\]/);
});

test('sendResendEmail never puts the API key in the request body', async () => {
  let capturedBody = null;
  const postFn = async (url, body) => {
    capturedBody = body;
    return { ok: true, status: 200 };
  };

  await sendResendEmail('re_super_secret', MESSAGE, postFn);

  assert.doesNotMatch(capturedBody, /re_super_secret/);
});
