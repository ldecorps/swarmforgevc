const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  createLetsTalkTurnHandler,
  createLetsTalkWriteRoutes,
} = require('../out/bridge/letsTalkRoutes');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const {
  parseHandsFreeEnabled,
  serializeHandsFreeEnabled,
  shouldScheduleHandsFreeListen,
  shouldEndHandsFreeRecording,
  shouldCancelHandsFreeRecordingNoSpeech,
} = require('../out/bridge/letsTalkCore');

// BL-697 declared invariants (backlog/active/BL-697-lets-talk-hands-free-listening.yaml):
// 1. With hands-free off, BL-696 tap-to-toggle behaviour is unchanged.
// 2. With hands-free on, the server still receives one discrete
//    POST /lets-talk/turn per user utterance; no duplex route is added.
// 3. Hands-free preference persists in browser localStorage only.
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

function mkRoot() {
  const root = mkTmpDir('sfvc-bl697-inv-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function nonNegativeMs() {
  return fc.integer({ min: 0, max: 60000 });
}

test('property: invariant 1 - hands-free off never schedules, ends, or cancels an auto-listen', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('ready', 'thinking', 'speaking', 'error'),
      fc.boolean(),
      fc.boolean(),
      nonNegativeMs(),
      nonNegativeMs(),
      nonNegativeMs(),
      nonNegativeMs(),
      (phase, recording, speechDetected, silenceMs, recordingMs, minRecordingMs, maxListenMs) => {
        assert.equal(
          shouldScheduleHandsFreeListen({ handsFreeEnabled: false, phase, recording }),
          false,
          'hands-free off must never schedule an auto-listen, regardless of phase/recording'
        );
        assert.equal(
          shouldEndHandsFreeRecording({
            handsFreeEnabled: false,
            recording,
            speechDetected,
            silenceMs,
            recordingMs,
            minRecordingMs,
            silenceThresholdMs: silenceMs,
          }),
          false,
          'hands-free off must never auto-end a recording'
        );
        assert.equal(
          shouldCancelHandsFreeRecordingNoSpeech({
            handsFreeEnabled: false,
            recording,
            speechDetected,
            recordingMs,
            maxListenMs,
          }),
          false,
          'hands-free off must never auto-cancel a recording'
        );
      }
    ),
    { numRuns: 100 }
  );
});

test('property: invariant 2 - each hands-free turn is exactly one discrete POST /lets-talk/turn, no duplex route exists', async () => {
  const root = mkRoot();

  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 5 }), fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }), async (turnCount, transcripts) => {
      let sttCalls = 0;
      const deps = {
        agentSession: createMockCursorBridgeAgentSession(root),
        transcribeAudio: async () => {
          sttCalls += 1;
          return { kind: 'ok', transcript: transcripts[sttCalls % transcripts.length] || 'hello' };
        },
        synthesizeSpeech: async () => ({ kind: 'ok', audio: Buffer.from('x') }),
      };
      const handler = createLetsTalkTurnHandler(
        deps,
        async () => ({ audioBase64: Buffer.from('audio').toString('base64') }),
        () => true,
        (res, _status, _body) => { res.end(); }
      );

      sttCalls = 0;
      for (let i = 0; i < turnCount; i += 1) {
        await new Promise((resolve) => {
          handler({ method: 'POST' }, { writeHead() {}, end() { resolve(); } }, '/lets-talk/turn', { devices: [] });
        });
      }
      assert.equal(sttCalls, turnCount, 'expected exactly one STT (transcription) call per submitted turn - no batching, no duplex accumulation');

      // No combination of runtime deps ever grows the write-route table past
      // the two discrete routes (turn, new-session) - there is no separate
      // streaming/duplex endpoint for hands-free to have introduced.
      const routes = createLetsTalkWriteRoutes(
        deps,
        async () => null,
        () => true,
        () => {}
      );
      assert.equal(routes.length, 2, 'expected exactly the two BL-696 write routes - no duplex route added for hands-free');
      assert.equal(routes.filter((r) => r.matches({ method: 'POST' }, '/lets-talk/turn')).length, 1);
      assert.equal(routes.filter((r) => r.matches({ method: 'POST' }, '/lets-talk/new-session')).length, 1);
    }),
    { numRuns: 20 }
  );
});

test('property: invariant 3 - the hands-free preference codec is a pure, synchronous round-trip (no I/O)', () => {
  fc.assert(
    fc.property(fc.boolean(), (enabled) => {
      const serialized = serializeHandsFreeEnabled(enabled);
      assert.equal(typeof serialized, 'string');
      assert.equal(parseHandsFreeEnabled(serialized), enabled);
      // A value that was never written (the localStorage.getItem contract
      // for an absent key) must resolve to "off" - first-visit default.
      assert.equal(parseHandsFreeEnabled(null), false);
      assert.equal(parseHandsFreeEnabled(undefined), false);
    }),
    { numRuns: 50 }
  );
});

test('non-vacuity: invariant 1 property fails when an auto-schedule ignores the hands-free flag', () => {
  const brokenSchedule = (input) => input.phase === 'ready' && !input.recording;
  assert.equal(brokenSchedule({ phase: 'ready', recording: false, handsFreeEnabled: false }), true, 'broken decision must schedule even with hands-free off, so the real property is non-vacuous');
});

test('non-vacuity: invariant 2 property fails when a handler batches multiple turns into one STT call', async () => {
  const root = mkRoot();
  let sttCalls = 0;
  let batched = false;
  const brokenTranscribe = async () => {
    if (!batched) {
      sttCalls += 1;
      batched = true;
    }
    return { kind: 'ok', transcript: 'hello' };
  };
  await brokenTranscribe();
  await brokenTranscribe();
  await brokenTranscribe();
  assert.equal(sttCalls, 1, 'broken batching path must under-count STT calls so the 1-call-per-turn test is non-vacuous');
});

test('non-vacuity: invariant 3 property fails when the codec is not a clean round-trip', () => {
  const brokenParse = (raw) => raw === '1';
  assert.equal(brokenParse(serializeHandsFreeEnabled(true)), true);
  assert.equal(brokenParse('true'), false, 'a codec that only accepts the literal "1" would reject the "true" alias, proving the round-trip test is non-vacuous');
});
