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
  replyTextForSpeechSynthesis,
  parseLetsTalkSpeechLanguage,
  speechLocaleForLanguage,
  formatLetsTalkAgentPrompt,
  resolveTurnSpeechLanguage,
  detectSpeechLanguageFromText,
  parseHandsFreeEnabled,
  serializeHandsFreeEnabled,
  shouldScheduleHandsFreeListen,
  shouldEndHandsFreeRecording,
  shouldCancelHandsFreeRecordingNoSpeech,
  computeAudioLevelRms,
  isSpeechAudioLevel,
  LETS_TALK_HANDS_FREE_SILENCE_MS,
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

test('letsTalk: replyTextForSpeechSynthesis strips markdown for TTS', () => {
  assert.equal(replyTextForSpeechSynthesis('**Ready** to try.'), 'Ready to try.');
  assert.equal(replyTextForSpeechSynthesis('# Summary\n\n- first item'), 'Summary\nfirst item');
  assert.equal(replyTextForSpeechSynthesis('Use `code` here.'), 'Use code here.');
  assert.equal(
    replyTextForSpeechSynthesis('Edit `extension/src/foo.ts` or `and/or`'),
    'Edit extension src foo.ts or and or'
  );
  assert.equal(replyTextForSpeechSynthesis('[docs](https://example.com)'), 'docs');
  assert.equal(replyTextForSpeechSynthesis('plain answer'), 'plain answer');
  assert.equal(replyTextForSpeechSynthesis('---'), '');
  assert.equal(
    replyTextForSpeechSynthesis('| Name | Value |\n| --- | --- |\n| foo | bar |'),
    'Name, Value\nfoo, bar'
  );
  assert.equal(replyTextForSpeechSynthesis('BL-696 is fine'), 'BL-696 is fine');
  assert.equal(replyTextForSpeechSynthesis('Use and/or cloud STT'), 'Use and or cloud STT');
  assert.equal(
    replyTextForSpeechSynthesis('Edit extension/src/bridge/letsTalkCore.ts'),
    'Edit extension src bridge letsTalkCore.ts'
  );
  assert.equal(
    replyTextForSpeechSynthesis('Open /lets-talk from /console'),
    'Open lets-talk from console'
  );
  assert.equal(
    replyTextForSpeechSynthesis('See https://example.com/foo/bar for docs'),
    'See for docs'
  );
  assert.equal(replyTextForSpeechSynthesis('About 1/2 done'), 'About 1 over 2 done');
});

test('letsTalk: speech language parsing and agent prompt', () => {
  assert.equal(parseLetsTalkSpeechLanguage(undefined), 'auto');
  assert.equal(parseLetsTalkSpeechLanguage('auto'), 'auto');
  assert.equal(parseLetsTalkSpeechLanguage('fr-FR'), 'fr');
  assert.equal(parseLetsTalkSpeechLanguage('en-US'), 'en');
  assert.equal(speechLocaleForLanguage('fr'), 'fr-FR');
  assert.match(formatLetsTalkAgentPrompt('quel est le statut', 'fr'), /réponds en français/i);
  assert.match(formatLetsTalkAgentPrompt('status check', 'en'), /voice playback/i);
  assert.match(formatLetsTalkAgentPrompt('status check', 'en'), /status check/);
});

test('letsTalk: auto language detection from transcript', () => {
  assert.equal(detectSpeechLanguageFromText('Bonjour, comment ça va'), 'fr');
  assert.equal(detectSpeechLanguageFromText('Hello, how are you'), 'en');
  assert.equal(resolveTurnSpeechLanguage('auto', 'merci beaucoup'), 'fr');
  assert.equal(resolveTurnSpeechLanguage('fr', 'hello there'), 'fr');
});

test('letsTalk: hands-free preference parsing', () => {
  assert.equal(parseHandsFreeEnabled('1'), true);
  assert.equal(parseHandsFreeEnabled('true'), true);
  assert.equal(parseHandsFreeEnabled('0'), false);
  assert.equal(serializeHandsFreeEnabled(true), '1');
  assert.equal(serializeHandsFreeEnabled(false), '0');
});

test('letsTalk: hands-free schedule and silence decisions', () => {
  assert.equal(
    shouldScheduleHandsFreeListen({ handsFreeEnabled: true, phase: 'ready', recording: false }),
    true
  );
  assert.equal(
    shouldScheduleHandsFreeListen({ handsFreeEnabled: true, phase: 'thinking', recording: false }),
    false
  );
  assert.equal(
    shouldEndHandsFreeRecording({
      handsFreeEnabled: true,
      recording: true,
      speechDetected: true,
      silenceMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
      recordingMs: 500,
      minRecordingMs: 400,
      silenceThresholdMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
    }),
    true
  );
  assert.equal(
    shouldEndHandsFreeRecording({
      handsFreeEnabled: true,
      recording: true,
      speechDetected: false,
      silenceMs: 5000,
      recordingMs: 500,
      minRecordingMs: 400,
      silenceThresholdMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
    }),
    false
  );
  assert.equal(
    shouldCancelHandsFreeRecordingNoSpeech({
      handsFreeEnabled: true,
      recording: true,
      speechDetected: false,
      recordingMs: 30000,
      maxListenMs: 30000,
    }),
    true
  );
});

test('letsTalk: audio level helpers', () => {
  assert.equal(computeAudioLevelRms([]), 0);
  assert.equal(isSpeechAudioLevel(0.05), true);
  assert.equal(isSpeechAudioLevel(0.001), false);
});
