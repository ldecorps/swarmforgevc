const assert = require('node:assert/strict');
const {
  decideSttOutcome,
  decodeLetsTalkAudio,
  extensionForMime,
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
  LETS_TALK_HANDS_FREE_SPEECH_LEVEL_THRESHOLD,
  LETS_TALK_HANDS_FREE_STORAGE_KEY,
  LETS_TALK_MINIMIZED_STORAGE_KEY,
  LETS_TALK_FLOAT_POS_STORAGE_KEY,
  countLanguageWordHits,
  isMarkdownTableSeparatorLine,
  flattenMarkdownTableRow,
  sanitizeSlashesForSpeech,
  stripHeadingMarkersForSpeech,
  stripBlockquoteMarkersForSpeech,
  stripBoldItalicForSpeech,
  stripListMarkersForSpeech,
  stripHorizontalRulesForSpeech,
  replaceMultiSegmentPathsForSpeech,
  replaceLeadingSlashSegmentsForSpeech,
  isAutoSpeechLanguageSetting,
  isBlankTranscript,
  normalizeTranscriptForLanguageDetection,
} = require('../out/bridge/letsTalkCore');

test('letsTalk: valid turn request shape', () => {
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: 'abc' }), true);
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: 'abc', mimeType: 'audio/webm' }), true);
  assert.equal(isLetsTalkTurnRequestShape({ text: 'hello from overlay' }), true);
  assert.equal(isLetsTalkTurnRequestShape({ text: '  hi  ' }), true);
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: '' }), false);
  assert.equal(isLetsTalkTurnRequestShape({ text: '' }), false);
  assert.equal(isLetsTalkTurnRequestShape({ text: '   ' }), false);
  assert.equal(isLetsTalkTurnRequestShape({ mimeType: 'audio/webm' }), false);
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: 'abc', text: 'both' }), false);
  assert.equal(isLetsTalkTurnRequestShape(null), false);
  assert.equal(isLetsTalkTurnRequestShape(undefined), false);
  assert.equal(isLetsTalkTurnRequestShape('not-an-object'), false);
  assert.equal(isLetsTalkTurnRequestShape(42), false);
  assert.equal(isLetsTalkTurnRequestShape(() => {}), false);
  const fn = function demo() {};
  fn.audioBase64 = 'abc';
  assert.equal(isLetsTalkTurnRequestShape(fn), false);
  assert.equal(isLetsTalkTurnRequestShape({ audioBase64: 'abc', mimeType: 42 }), false);
});

test('letsTalk: extensionForMime maps mime types and defaults', () => {
  assert.equal(extensionForMime(undefined), 'audio.webm');
  assert.equal(extensionForMime('audio/mpeg'), 'audio.mp3');
  assert.equal(extensionForMime('audio/mp3'), 'audio.mp3');
  assert.equal(extensionForMime('audio/m4a'), 'audio.m4a');
  assert.equal(extensionForMime('audio/caf'), 'audio.m4a');
  assert.equal(extensionForMime('audio/x-caf'), 'audio.m4a');
  assert.equal(extensionForMime('application/octet-stream'), 'audio.webm');
});

test('letsTalk: decode audio rejects empty and invalid base64', () => {
  assert.ok(decodeLetsTalkAudio(Buffer.from('x').toString('base64')));
  assert.equal(decodeLetsTalkAudio(''), undefined);
  assert.equal(decodeLetsTalkAudio('!!!'), undefined);
});

test('letsTalk: STT failure mapping', () => {
  assert.deepEqual(sttFailureForOutcome('retry', { kind: 'transient-failure' }), {
    success: false,
    reason: 'speech-to-text is temporarily unavailable — try again',
    recoverable: true,
    state: 'error',
  });
  assert.deepEqual(sttFailureForOutcome('retry', { kind: 'transient-failure', reason: 'network down' }), {
    success: false,
    reason: 'network down',
    recoverable: true,
    state: 'error',
  });
  assert.deepEqual(sttFailureForOutcome('retry', { kind: 'unprocessable', reason: 'quota exceeded' }), {
    success: false,
    reason: 'speech-to-text is temporarily unavailable — try again',
    recoverable: true,
    state: 'error',
  });
  assert.deepEqual(sttFailureForOutcome('unprocessable', { kind: 'unprocessable', reason: 'bad audio' }), {
    success: false,
    reason: 'bad audio',
    recoverable: true,
    state: 'ready',
  });
  assert.deepEqual(sttFailureForOutcome('unprocessable', { kind: 'unprocessable' }), {
    success: false,
    reason: unprocessableAudioMessage(),
    recoverable: true,
    state: 'ready',
  });
  assert.deepEqual(sttFailureForOutcome('prompt', { kind: 'ok', transcript: 'hi' }), null);
  assert.deepEqual(sttFailureForOutcome('prompt', { kind: 'unprocessable', reason: 'decode failed' }), {
    success: false,
    reason: 'decode failed',
    recoverable: true,
    state: 'ready',
  });
  assert.deepEqual(sttFailureForOutcome('unprocessable', { kind: 'ok', transcript: 'hi' }), {
    success: false,
    reason: unprocessableAudioMessage(),
    recoverable: true,
    state: 'ready',
  });
  assert.deepEqual(
    sttFailureForOutcome('unprocessable', { kind: 'ok', transcript: 'hi', reason: 'ignored' }),
    {
      success: false,
      reason: unprocessableAudioMessage(),
      recoverable: true,
      state: 'ready',
    }
  );
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
  assert.equal(extractCodeWordFromRememberPhrase('  Remember The Code Word gamma  '), 'gamma');
  assert.equal(extractCodeWordFromRememberPhrase('remember  the  code  word DELTA'), 'DELTA');
  assert.equal(extractCodeWordFromRememberPhrase('remember the code word  OMEGA'), 'OMEGA');
  assert.equal(extractCodeWordFromRememberPhrase('remember\nthe code word ZETA'), 'ZETA');
  assert.equal(extractCodeWordFromRememberPhrase('no code word here'), undefined);
  const remember = mockAgentReplyForTranscript('remember the code word BETA', undefined);
  assert.equal(remember, 'Got it — I will remember the code word BETA.');
  const recall = mockAgentReplyForTranscript('what was the code word', 'BETA');
  assert.match(recall, /BETA/);
  const noRecall = mockAgentReplyForTranscript('what was the code word', undefined);
  assert.match(noRecall, /do not have a code word/i);
  assert.equal(mockAgentReplyForTranscript('  hello world  ', undefined), 'You said: hello world');
});

test('letsTalk: unprocessable audio message is recoverable copy', () => {
  assert.match(unprocessableAudioMessage(), /could not be decoded/i);
});

test('letsTalk: replyTextForSpeechSynthesis strips markdown for TTS', () => {
  assert.equal(replyTextForSpeechSynthesis('**Ready** to try.'), 'Ready to try.');
  assert.equal(replyTextForSpeechSynthesis('# Summary\n\n- first item'), 'Summary\nfirst item');
  assert.equal(replyTextForSpeechSynthesis('## Heading two'), 'Heading two');
  assert.equal(replyTextForSpeechSynthesis('### Heading three'), 'Heading three');
  assert.equal(replyTextForSpeechSynthesis('#### H4'), 'H4');
  assert.equal(replyTextForSpeechSynthesis('##### H5'), 'H5');
  assert.equal(replyTextForSpeechSynthesis('###### H6'), 'H6');
  assert.equal(replyTextForSpeechSynthesis('text ## not heading'), 'text not heading');
  assert.equal(replyTextForSpeechSynthesis('Use `code` here.'), 'Use code here.');
  assert.equal(replyTextForSpeechSynthesis('```typescript\nconst x = 1\n```'), 'const x = 1');
  assert.equal(replyTextForSpeechSynthesis('```\ncode block\n```'), 'code block');
  assert.equal(
    replyTextForSpeechSynthesis('Edit `extension/src/foo.ts` or `and/or`'),
    'Edit extension src foo.ts or and or'
  );
  assert.equal(replyTextForSpeechSynthesis('[docs](https://example.com)'), 'docs');
  assert.equal(replyTextForSpeechSynthesis('![alt text](http://x.com/a.png)'), 'alt text');
  assert.equal(replyTextForSpeechSynthesis('<div>hello</div>'), 'hello');
  assert.equal(replyTextForSpeechSynthesis('<br/>line'), 'line');
  assert.equal(replyTextForSpeechSynthesis('<b>x</b> <i>y</i>'), 'x y');
  assert.equal(replyTextForSpeechSynthesis('<b>x</b><i>y</i>'), 'x y');
  assert.equal(replyTextForSpeechSynthesis('> quoted text'), 'quoted text');
  assert.equal(replyTextForSpeechSynthesis('>no space after'), 'no space after');
  assert.equal(replyTextForSpeechSynthesis('line with > not at start'), 'line with > not at start');
  assert.equal(replyTextForSpeechSynthesis('*italic* and __bold__ and _also_'), 'italic and bold and also');
  assert.equal(replyTextForSpeechSynthesis('**ab**'), 'ab');
  assert.equal(replyTextForSpeechSynthesis('_ab_'), 'ab');
  assert.equal(replyTextForSpeechSynthesis('1. first\n2. second'), 'first\nsecond');
  assert.equal(replyTextForSpeechSynthesis('   1. indented'), 'indented');
  assert.equal(replyTextForSpeechSynthesis('12. numbered'), 'numbered');
  assert.equal(replyTextForSpeechSynthesis('123. long number'), 'long number');
  assert.equal(replyTextForSpeechSynthesis('+ item'), 'item');
  assert.equal(replyTextForSpeechSynthesis('- item one\n* item two'), 'item one\nitem two');
  assert.equal(replyTextForSpeechSynthesis('- not a separator'), 'not a separator');
  assert.equal(replyTextForSpeechSynthesis('plain answer'), 'plain answer');
  assert.equal(replyTextForSpeechSynthesis('**a** *b* __c__ _d_'), 'a b c d');
  assert.equal(replyTextForSpeechSynthesis('word__nested__test'), 'wordnestedtest');
  assert.equal(replyTextForSpeechSynthesis('hello_world'), 'hello world');
  assert.equal(replyTextForSpeechSynthesis('hello---'), 'hello');
  assert.equal(replyTextForSpeechSynthesis('a*b*c'), 'abc');
  assert.equal(replyTextForSpeechSynthesis('foo--bar'), 'foo bar');
  assert.equal(replyTextForSpeechSynthesis('<b>x</b> <i>y</i>'), 'x y');
  assert.equal(replyTextForSpeechSynthesis('#tag ~tilde [bracket]'), 'tag tilde bracket');
  assert.equal(replyTextForSpeechSynthesis('hello\t\tworld'), 'hello world');
  assert.equal(replyTextForSpeechSynthesis('```typescriptcode```'), '');
  assert.equal(replyTextForSpeechSynthesis('---'), '');
  assert.equal(replyTextForSpeechSynthesis('***'), '');
  assert.equal(replyTextForSpeechSynthesis('* * *'), '');
  assert.equal(replyTextForSpeechSynthesis('___'), '');
  assert.equal(replyTextForSpeechSynthesis('   ---   '), '');
  assert.equal(replyTextForSpeechSynthesis('-*-'), '');
  assert.equal(replyTextForSpeechSynthesis('------'), '');
  assert.equal(
    replyTextForSpeechSynthesis('| Name | Value |\n| --- | --- |\n| foo | bar |'),
    'Name, Value\nfoo, bar'
  );
  assert.equal(
    replyTextForSpeechSynthesis('| Name | Value |\n|:---:|---|\n| a | b |'),
    'Name, Value\na, b'
  );
  assert.equal(replyTextForSpeechSynthesis('| --- | :---: |'), '');
  assert.equal(replyTextForSpeechSynthesis('| --- | --- |'), '');
  assert.equal(replyTextForSpeechSynthesis('  | --- | --- |  '), '');
  assert.equal(replyTextForSpeechSynthesis('|:---:|'), '');
  assert.equal(replyTextForSpeechSynthesis('|'), '');
  assert.equal(replyTextForSpeechSynthesis('hello\n| | |\nworld'), 'hello\n\nworld');
  assert.equal(replyTextForSpeechSynthesis('before\n|   |\nafter'), 'before\n\nafter');
  assert.equal(replyTextForSpeechSynthesis('text with | pipe'), 'text with, pipe');
  assert.equal(replyTextForSpeechSynthesis('| only | one |'), 'only, one');
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
  assert.equal(replyTextForSpeechSynthesis('http://example.com/foo'), '');
  assert.equal(replyTextForSpeechSynthesis('see www.example.com/path'), 'see');
  assert.equal(replyTextForSpeechSynthesis('About 1/2 done'), 'About 1 over 2 done');
  assert.equal(replyTextForSpeechSynthesis('10/20 done'), '10 over 20 done');
  assert.equal(replyTextForSpeechSynthesis('foo/bar'), 'foo bar');
  assert.equal(replyTextForSpeechSynthesis('/api/v1'), 'api v1');
  assert.equal(replyTextForSpeechSynthesis('/123bad'), '123bad');
  assert.equal(replyTextForSpeechSynthesis('@user/foo/bar'), '@user foo bar');
  assert.equal(replyTextForSpeechSynthesis('path/with/special-chars'), 'path with special-chars');
  assert.equal(replyTextForSpeechSynthesis('user@host.com/foo/bar'), 'user@host.com foo bar');
  assert.equal(replyTextForSpeechSynthesis('$HOME/projects/app/src'), '$HOME projects app src');
  assert.equal(replyTextForSpeechSynthesis('my.path/foo/bar'), 'my.path foo bar');
  assert.equal(replyTextForSpeechSynthesis('src/foo/bar/baz'), 'src foo bar baz');
  assert.equal(replyTextForSpeechSynthesis('foo : bar'), 'foo bar');
  assert.equal(replyTextForSpeechSynthesis('a\n\n\n\nb'), 'a\n\nb');
  assert.equal(replyTextForSpeechSynthesis('hello   \nworld'), 'hello\nworld');
  assert.equal(replyTextForSpeechSynthesis('hello  world'), 'hello world');
  assert.equal(replyTextForSpeechSynthesis('hello\tworld'), 'hello\tworld');
  assert.equal(replyTextForSpeechSynthesis('123/foo/bar'), '123 foo bar');
  assert.equal(replyTextForSpeechSynthesis('1a/2b/3c'), '1a 2b 3c');
  assert.equal(replyTextForSpeechSynthesis('a+/foo/bar'), 'a+ foo bar');
  assert.equal(replyTextForSpeechSynthesis('/a_b/c/d'), 'a b c d');
  assert.equal(replyTextForSpeechSynthesis('-  spaced item'), 'spaced item');
  assert.equal(replyTextForSpeechSynthesis('a**b'), 'a b');
  assert.equal(replyTextForSpeechSynthesis('foo__bar'), 'foo bar');
});

test('letsTalk: speech language parsing and agent prompt', () => {
  assert.equal(isAutoSpeechLanguageSetting('auto'), true);
  assert.equal(isAutoSpeechLanguageSetting('english'), false);
  assert.equal(parseLetsTalkSpeechLanguage(undefined), 'auto');
  assert.equal(parseLetsTalkSpeechLanguage('auto'), 'auto');
  assert.equal(parseLetsTalkSpeechLanguage('unknown-lang'), 'auto');
  assert.equal(parseLetsTalkSpeechLanguage('fr-FR'), 'fr');
  assert.equal(parseLetsTalkSpeechLanguage('french'), 'fr');
  assert.equal(parseLetsTalkSpeechLanguage('  FR  '), 'fr');
  assert.equal(parseLetsTalkSpeechLanguage('en-US'), 'en');
  assert.equal(parseLetsTalkSpeechLanguage('en'), 'en');
  assert.equal(parseLetsTalkSpeechLanguage('english'), 'en');
  assert.equal(parseLetsTalkSpeechLanguage('deutsch'), 'auto');
  assert.equal(speechLocaleForLanguage('fr'), 'fr-FR');
  assert.equal(speechLocaleForLanguage('en'), 'en-US');
  assert.match(formatLetsTalkAgentPrompt('quel est le statut', 'fr'), /réponds en français/i);
  assert.match(formatLetsTalkAgentPrompt('status check', 'en'), /voice playback/i);
  assert.match(formatLetsTalkAgentPrompt('status check', 'en'), /status check/);
  assert.match(formatLetsTalkAgentPrompt('  trimmed prompt  ', 'en'), /trimmed prompt$/);
});

test('letsTalk: auto language detection from transcript', () => {
  assert.equal(isBlankTranscript(''), true);
  assert.equal(isBlankTranscript('   '), true);
  assert.equal(isBlankTranscript('hello'), false);
  assert.equal(normalizeTranscriptForLanguageDetection('  hello thanks  '), 'hello thanks');
  assert.equal(detectSpeechLanguageFromText('Bonjour, comment ça va'), 'fr');
  assert.equal(detectSpeechLanguageFromText('café'), 'fr');
  assert.equal(detectSpeechLanguageFromText('Hello, how are you'), 'en');
  assert.equal(detectSpeechLanguageFromText('hello thanks yes the'), 'en');
  assert.equal(detectSpeechLanguageFromText('thanks thank you yes the what when'), 'en');
  assert.equal(detectSpeechLanguageFromText('bonjour xyz'), 'fr');
  assert.equal(detectSpeechLanguageFromText('bonjour hello'), 'en');
  assert.equal(detectSpeechLanguageFromText(''), 'en');
  assert.equal(detectSpeechLanguageFromText('   '), 'en');
  assert.equal(resolveTurnSpeechLanguage('auto', 'merci beaucoup'), 'fr');
  assert.equal(resolveTurnSpeechLanguage('fr', 'hello there'), 'fr');
  assert.equal(resolveTurnSpeechLanguage('en', 'bonjour'), 'en');
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
    shouldScheduleHandsFreeListen({ handsFreeEnabled: false, phase: 'ready', recording: false }),
    false
  );
  assert.equal(
    shouldScheduleHandsFreeListen({ handsFreeEnabled: true, phase: 'ready', recording: true }),
    false
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
      handsFreeEnabled: false,
      recording: true,
      speechDetected: true,
      silenceMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
      recordingMs: 500,
      minRecordingMs: 400,
      silenceThresholdMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
    }),
    false
  );
  assert.equal(
    shouldEndHandsFreeRecording({
      handsFreeEnabled: true,
      recording: false,
      speechDetected: true,
      silenceMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
      recordingMs: 500,
      minRecordingMs: 400,
      silenceThresholdMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
    }),
    false
  );
  assert.equal(
    shouldEndHandsFreeRecording({
      handsFreeEnabled: true,
      recording: true,
      speechDetected: true,
      silenceMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
      recordingMs: 300,
      minRecordingMs: 400,
      silenceThresholdMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
    }),
    false
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
    shouldEndHandsFreeRecording({
      handsFreeEnabled: true,
      recording: true,
      speechDetected: true,
      silenceMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
      recordingMs: 400,
      minRecordingMs: 400,
      silenceThresholdMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
    }),
    true
  );
  assert.equal(
    shouldEndHandsFreeRecording({
      handsFreeEnabled: true,
      recording: true,
      speechDetected: true,
      silenceMs: LETS_TALK_HANDS_FREE_SILENCE_MS - 1,
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
  assert.equal(
    shouldCancelHandsFreeRecordingNoSpeech({
      handsFreeEnabled: true,
      recording: true,
      speechDetected: false,
      recordingMs: 29999,
      maxListenMs: 30000,
    }),
    false
  );
  assert.equal(
    shouldCancelHandsFreeRecordingNoSpeech({
      handsFreeEnabled: false,
      recording: true,
      speechDetected: false,
      recordingMs: 30000,
      maxListenMs: 30000,
    }),
    false
  );
});

test('letsTalk: audio level helpers', () => {
  assert.equal(computeAudioLevelRms([]), 0);
  assert.ok(Math.abs(computeAudioLevelRms([0.3, 0.4]) - 0.3535533905932738) < 1e-10);
  assert.equal(isSpeechAudioLevel(0.05), true);
  assert.equal(isSpeechAudioLevel(LETS_TALK_HANDS_FREE_SPEECH_LEVEL_THRESHOLD), true);
  assert.equal(isSpeechAudioLevel(0.001), false);
});

test('letsTalk: exported hands-free and floating-bubble storage keys', () => {
  assert.equal(LETS_TALK_HANDS_FREE_STORAGE_KEY, 'lets-talk-hands-free');
  assert.equal(LETS_TALK_MINIMIZED_STORAGE_KEY, 'lets-talk-minimized');
  assert.equal(LETS_TALK_FLOAT_POS_STORAGE_KEY, 'lets-talk-float-pos');
});

test('letsTalk: countLanguageWordHits uses empty fallback when no matches', () => {
  assert.equal(countLanguageWordHits('hello world', /\bhello\b/g), 1);
  assert.equal(countLanguageWordHits('xyz', /\bhello\b/g), 0);
});

test('letsTalk: markdown table helpers', () => {
  assert.equal(isMarkdownTableSeparatorLine('hello'), false);
  assert.equal(isMarkdownTableSeparatorLine('| --- | --- |'), true);
  assert.equal(isMarkdownTableSeparatorLine('|:---:|'), true);
  assert.equal(isMarkdownTableSeparatorLine(' --- '), true);
  assert.equal(isMarkdownTableSeparatorLine('|:-:|'), true);
  assert.equal(isMarkdownTableSeparatorLine('| | |'), false);
  assert.equal(isMarkdownTableSeparatorLine('- not a separator'), false);
  assert.equal(flattenMarkdownTableRow('plain line'), 'plain line');
  assert.equal(flattenMarkdownTableRow('| a | b |'), 'a, b');
  assert.equal(flattenMarkdownTableRow('| --- | --- |'), ' ');
  assert.equal(flattenMarkdownTableRow('|   |   |'), ' ');
  assert.equal(flattenMarkdownTableRow('| :---: | --- |'), ' ');
  assert.equal(flattenMarkdownTableRow('| :-- | --: |'), ':--, --:');
  assert.equal(flattenMarkdownTableRow('| -- |'), '--');
  assert.equal(flattenMarkdownTableRow('| --- |'), ' ');
  assert.equal(isMarkdownTableSeparatorLine('| :--: |'), true);
  assert.equal(isMarkdownTableSeparatorLine('| :---: |'), true);
  assert.equal(flattenMarkdownTableRow('| ab--- | c |'), 'ab---, c');
  assert.equal(flattenMarkdownTableRow('| :---: |'), ' ');
  assert.equal(flattenMarkdownTableRow('| :----: |'), ' ');
  assert.equal(flattenMarkdownTableRow('|----|'), ' ');
  assert.equal(flattenMarkdownTableRow('| :--extra | b |'), ':--extra, b');
  assert.equal(isMarkdownTableSeparatorLine('| :-: |'), true);
  assert.equal(isMarkdownTableSeparatorLine('|----|'), true);
  assert.equal(isMarkdownTableSeparatorLine('| :----: |'), true);
  assert.equal(isMarkdownTableSeparatorLine('---'), true);
  assert.equal(isMarkdownTableSeparatorLine(' |---| '), true);
  assert.equal(isMarkdownTableSeparatorLine('| --- | note'), false);
  assert.equal(isMarkdownTableSeparatorLine('| -- |'), false);
  assert.equal(flattenMarkdownTableRow('| ---note | b |'), '---note, b');
});

test('letsTalk: isMarkdownTableSeparatorLine early-return edge cases', () => {
  assert.equal(isMarkdownTableSeparatorLine('no pipes or dashes'), false);
  assert.equal(isMarkdownTableSeparatorLine('has|pipe'), false);
  assert.equal(isMarkdownTableSeparatorLine('has-dash'), false);
});

test('letsTalk: stripHorizontalRulesForSpeech edge cases', () => {
  assert.equal(stripHorizontalRulesForSpeech('---'), ' ');
  assert.equal(stripHorizontalRulesForSpeech('hello---'), 'hello ');
  assert.equal(stripHorizontalRulesForSpeech('foo--bar'), 'foo bar');
  assert.equal(stripHorizontalRulesForSpeech('foo__bar'), 'foo bar');
  assert.equal(stripHorizontalRulesForSpeech('---a'), ' a');
  assert.equal(stripHorizontalRulesForSpeech('___hello'), ' hello');
  assert.equal(stripHorizontalRulesForSpeech('hello\n---\nworld'), 'hello\n \nworld');
  assert.equal(stripHorizontalRulesForSpeech('hello_world'), 'hello_world');
  assert.equal(stripHorizontalRulesForSpeech('a**b'), 'a b');
});

test('letsTalk: stripListMarkersForSpeech edge cases', () => {
  assert.equal(stripListMarkersForSpeech('- one\n+ two'), 'one\ntwo');
  assert.equal(stripListMarkersForSpeech('   1. first\n12. second'), 'first\nsecond');
  assert.equal(stripListMarkersForSpeech('-  item'), 'item');
  assert.equal(stripListMarkersForSpeech('12.  item'), 'item');
  assert.equal(stripListMarkersForSpeech('12.item'), '12.item');
});

test('letsTalk: speech strip helpers', () => {
  assert.equal(stripHeadingMarkersForSpeech('## Title'), 'Title');
  assert.equal(stripHeadingMarkersForSpeech('##  Two spaces'), 'Two spaces');
  assert.equal(stripHeadingMarkersForSpeech('#### H4'), 'H4');
  assert.equal(stripHeadingMarkersForSpeech('text ## not heading'), 'text ## not heading');
  assert.equal(stripBlockquoteMarkersForSpeech('> quoted'), 'quoted');
  assert.equal(stripBlockquoteMarkersForSpeech('>no space'), 'no space');
  assert.equal(stripBlockquoteMarkersForSpeech('line > keep'), 'line > keep');
  assert.equal(stripBoldItalicForSpeech('**ab**'), 'ab');
  assert.equal(stripBoldItalicForSpeech('*ab*'), 'ab');
  assert.equal(stripBoldItalicForSpeech('_ab_'), 'ab');
  assert.equal(stripBoldItalicForSpeech('*a* __b__ _c_'), 'a b c');
  assert.equal(stripListMarkersForSpeech('- one\n+ two'), 'one\ntwo');
  assert.equal(stripListMarkersForSpeech('   1. first\n12. second'), 'first\nsecond');
  assert.equal(stripHorizontalRulesForSpeech('---'), ' ');
  assert.equal(stripHorizontalRulesForSpeech('hello---'), 'hello ');
  assert.equal(stripHorizontalRulesForSpeech('foo--bar'), 'foo bar');
  assert.equal(stripHorizontalRulesForSpeech('hello_world'), 'hello_world');
  assert.equal(stripHorizontalRulesForSpeech('a*b'), 'a*b');
  assert.equal(stripListMarkersForSpeech('12.  item'), 'item');
  assert.equal(stripListMarkersForSpeech('12.item'), '12.item');
});

test('letsTalk: sanitizeSlashesForSpeech normalizes paths and urls', () => {
  assert.equal(sanitizeSlashesForSpeech('Use and/or cloud'), 'Use and or cloud');
  assert.equal(sanitizeSlashesForSpeech('See https://example.com/foo'), 'See ');
  assert.equal(sanitizeSlashesForSpeech('See http://example.com/foo'), 'See ');
  assert.equal(sanitizeSlashesForSpeech('Visit www.example.com/docs'), 'Visit ');
  assert.equal(sanitizeSlashesForSpeech('About 10/20 done'), 'About 10 over 20 done');
  assert.equal(sanitizeSlashesForSpeech('src/foo/bar'), 'src foo bar');
  assert.equal(sanitizeSlashesForSpeech('$HOME/projects/app'), '$HOME projects app');
  assert.equal(sanitizeSlashesForSpeech('my.path/foo/bar'), 'my.path foo bar');
  assert.equal(sanitizeSlashesForSpeech('/api/v1'), ' api v1');
  assert.equal(sanitizeSlashesForSpeech('/x-y/z'), ' x-y z');
  assert.equal(sanitizeSlashesForSpeech('foo / bar'), 'foo   bar');
  assert.equal(sanitizeSlashesForSpeech('foo/bar'), 'foo bar');
});

test('letsTalk: path slash helper functions', () => {
  assert.equal(replaceMultiSegmentPathsForSpeech('src/foo/bar/baz'), 'src foo bar baz');
  assert.equal(replaceMultiSegmentPathsForSpeech('$HOME/projects/app'), '$HOME projects app');
  assert.equal(replaceMultiSegmentPathsForSpeech('my.path/foo/bar'), 'my.path foo bar');
  assert.equal(replaceMultiSegmentPathsForSpeech('a-b/foo/bar'), 'a-b foo bar');
  assert.equal(replaceMultiSegmentPathsForSpeech('_x/foo/bar'), '_x foo bar');
  assert.equal(replaceMultiSegmentPathsForSpeech('123/foo/bar'), '123/foo bar');
  assert.equal(replaceMultiSegmentPathsForSpeech('1a/2b/3c'), '1a 2b 3c');
  assert.equal(replaceMultiSegmentPathsForSpeech('a+/foo/bar'), 'a+/foo bar');
  assert.equal(replaceMultiSegmentPathsForSpeech('user@host.com/foo/bar'), 'user@host.com foo bar');
  assert.equal(replaceLeadingSlashSegmentsForSpeech('/api/v1'), ' api v1');
  assert.equal(replaceLeadingSlashSegmentsForSpeech('/x-y/z'), ' x-y z');
  assert.equal(replaceLeadingSlashSegmentsForSpeech('/a_b/c/d'), ' a_b c d');
  assert.equal(replaceLeadingSlashSegmentsForSpeech('/ab-c/d'), ' ab-c d');
  assert.equal(replaceLeadingSlashSegmentsForSpeech('plain'), 'plain');
});
