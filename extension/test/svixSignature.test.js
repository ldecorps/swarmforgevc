const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySvixSignature } = require('../out/notify/svixSignature');

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

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
