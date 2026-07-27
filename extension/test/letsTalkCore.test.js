const assert = require('node:assert/strict');
const {
  decideSttOutcome,
  decodeLetsTalkAudio,
  extractCodeWordFromRememberPhrase,
  mockAgentReplyForTranscript,
  isLetsTalkTurnRequestShape,
  sttFailureForOutcome,
  sttRetryBudgetExhausted,
  unprocessableAudioMessage,
  LETS_TALK_STT_RETRY_BUDGET,
} = require('../out/bridge/letsTalkCore');

test('letsTalk: valid turn request shape', () => {
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: 'abc' }), true);
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: 'abc', mimeType: 'audio/webm' }), true);
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: '' }), false);
  assert.equal(isLetsTalkTurnRequestShape({ mimeType: 'audio/webm' }), false);
  assert.equal(isLetsTalkTurnRequestShape(null), false);
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: 'abc', mimeType: 42 }), false);
});

test('letsTalk: decode audio rejects empty and invalid base64', () => {
  assert.ok(decodeLetsTalkAudio(Buffer.from('x').toString('base64')));
  assert.equal(decodeLetsTalkAudio(''), undefined);
  assert.equal(decodeLetsTalkAudio('!!!'), undefined);
});

test('letsTalk: STT failure mapping', () => {
  assert.deepEqual(sttFailureForOutcome('retry', { kind: 'transient-failure' })?.state, 'error');
  assert.deepEqual(sttFailureForOutcome('unprocessable', { kind: 'unprocessable' })?.state, 'ready');
  assert.equal(sttFailureForOutcome('prompt', { kind: 'ok', transcript: 'hi' }), null);
});

test('letsTalk: STT outcome routing', () => {
  assert.equal(decideSttOutcome({ kind: 'ok', transcript: 'hi' }), 'prompt');
  assert.equal(decideSttOutcome({ kind: 'transient-failure' }), 'retry');
  assert.equal(decideSttOutcome({ kind: 'unprocessable' }), 'unprocessable');
});

test('letsTalk: retry budget', () => {
  assert.equal(sttRetryBudgetExhausted(2, LETS_TALK_STT_RETRY_BUDGET), false);
  assert.equal(sttRetryBudgetExhausted(3, LETS_TALK_STT_RETRY_BUDGET), true);
});

test('letsTalk: code word remember and recall', () => {
  assert.equal(extractCodeWordFromRememberPhrase('remember the code word ALPHA'), 'ALPHA');
  const remember = mockAgentReplyForTranscript('remember the code word BETA', undefined);
  assert.match(remember, /BETA/);
  const recall = mockAgentReplyForTranscript('what was the code word', 'BETA');
  assert.match(recall, /BETA/);
  const noRecall = mockAgentReplyForTranscript('what was the code word', undefined);
  assert.match(noRecall, /do not have a code word/i);
});

test('letsTalk: unprocessable audio message is recoverable copy', () => {
  assert.match(unprocessableAudioMessage(), /could not be decoded/i);
});
