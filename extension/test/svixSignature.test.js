const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySvixSignature, isTimestampFresh, SVIX_TIMESTAMP_TOLERANCE_SECONDS } = require('../out/notify/svixSignature');

// BL-225: built at runtime from an obviously-fake seed, not a committed
// whsec_ literal (GitGuardian flagged the fixed literal across history as
// a "Stripe Webhook Secret" false positive - whsec_ is shared by Svix and
// Stripe). Still base64-decodes to real HMAC bytes, same as before.
const SECRET = 'whsec_' + Buffer.from('bl-225-fake-fixture-seed').toString('base64');

function sign(id, timestamp, rawBody, secret = SECRET) {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

test('verifySvixSignature accepts a correctly signed request', () => {
  const rawBody = '{"hello":"world"}';
  const headers = { svixId: 'msg_1', svixTimestamp: '1614265330', svixSignature: sign('msg_1', '1614265330', rawBody) };
  assert.equal(verifySvixSignature(headers, rawBody, SECRET), true);
});

test('verifySvixSignature rejects a request signed with the wrong secret', () => {
  const rawBody = '{"hello":"world"}';
  const wrongSecret = 'whsec_' + Buffer.from('not-the-real-secret-bytes').toString('base64');
  const headers = { svixId: 'msg_1', svixTimestamp: '1614265330', svixSignature: sign('msg_1', '1614265330', rawBody, wrongSecret) };
  assert.equal(verifySvixSignature(headers, rawBody, SECRET), false);
});

test('verifySvixSignature rejects a request whose body was tampered with after signing', () => {
  const signedBody = '{"hello":"world"}';
  const tamperedBody = '{"hello":"tampered"}';
  const headers = { svixId: 'msg_1', svixTimestamp: '1614265330', svixSignature: sign('msg_1', '1614265330', signedBody) };
  assert.equal(verifySvixSignature(headers, tamperedBody, SECRET), false);
});

test('verifySvixSignature rejects a garbage/missing signature header', () => {
  const rawBody = '{"hello":"world"}';
  const headers = { svixId: 'msg_1', svixTimestamp: '1614265330', svixSignature: 'v1,not-a-real-signature' };
  assert.equal(verifySvixSignature(headers, rawBody, SECRET), false);
});

test('verifySvixSignature accepts when any one of several space-separated signature candidates matches', () => {
  const rawBody = '{"hello":"world"}';
  const real = sign('msg_1', '1614265330', rawBody);
  const headers = { svixId: 'msg_1', svixTimestamp: '1614265330', svixSignature: `v1,bogusbogusbogus== ${real}` };
  assert.equal(verifySvixSignature(headers, rawBody, SECRET), true);
});

test('verifySvixSignature rejects when svixId or svixTimestamp does not match what was signed', () => {
  const rawBody = '{"hello":"world"}';
  const headers = { svixId: 'msg_2', svixTimestamp: '1614265330', svixSignature: sign('msg_1', '1614265330', rawBody) };
  assert.equal(verifySvixSignature(headers, rawBody, SECRET), false);
});

// ── isTimestampFresh (BL-217 QA bounce: replayed/stale request) ────────────
// verifySvixSignature only checks the HMAC, so a request captured once and
// resubmitted years later still verifies - a valid signature is not the
// same as a fresh delivery. isTimestampFresh is the second, independent
// check a caller must also make (Svix's own guide: reject outside a
// tolerance window). Kept separate from verifySvixSignature rather than
// folded in, so the HMAC check stays a single-purpose pure function.

const NOW_MS = Date.parse('2026-07-09T12:00:00Z');
const NOW_SECONDS = String(Math.floor(NOW_MS / 1000));

test('isTimestampFresh accepts a timestamp equal to now', () => {
  assert.equal(isTimestampFresh(NOW_SECONDS, NOW_MS), true);
});

test('isTimestampFresh accepts a timestamp within the tolerance window, in the past or future', () => {
  const pastMs = NOW_MS - (SVIX_TIMESTAMP_TOLERANCE_SECONDS - 5) * 1000;
  const futureMs = NOW_MS + (SVIX_TIMESTAMP_TOLERANCE_SECONDS - 5) * 1000;
  assert.equal(isTimestampFresh(String(Math.floor(pastMs / 1000)), NOW_MS), true);
  assert.equal(isTimestampFresh(String(Math.floor(futureMs / 1000)), NOW_MS), true);
});

test('isTimestampFresh rejects a timestamp older than the tolerance window (the replay case)', () => {
  const staleTimestamp = '1614265330'; // 2021-02-25 - QA's exact repro
  assert.equal(isTimestampFresh(staleTimestamp, NOW_MS), false);
});

test('isTimestampFresh rejects a timestamp from suspiciously far in the future too', () => {
  const futureMs = NOW_MS + (SVIX_TIMESTAMP_TOLERANCE_SECONDS + 60) * 1000;
  assert.equal(isTimestampFresh(String(Math.floor(futureMs / 1000)), NOW_MS), false);
});

test('isTimestampFresh rejects a non-numeric timestamp rather than throwing', () => {
  assert.equal(isTimestampFresh('not-a-number', NOW_MS), false);
});

test('isTimestampFresh honors an explicit tolerance override', () => {
  const justOverOneMinute = NOW_MS - 61_000;
  assert.equal(isTimestampFresh(String(Math.floor(justOverOneMinute / 1000)), NOW_MS, 60), false);
  assert.equal(isTimestampFresh(String(Math.floor(justOverOneMinute / 1000)), NOW_MS, 120), true);
});
