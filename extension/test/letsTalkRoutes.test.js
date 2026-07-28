const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const {
  isLetsTalkPath,
  isLetsTalkTurnRoute,
  isLetsTalkNewSessionRoute,
  processLetsTalkTurn,
  createLetsTalkWriteRoutes,
  createLetsTalkTurnHandler,
  createLetsTalkNewSessionHandler,
  LETS_TALK_TURN_MAX_BODY_BYTES,
} = require('../out/bridge/letsTalkRoutes');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const { unprocessableAudioMessage } = require('../out/bridge/letsTalkCore');

const SAMPLE_AUDIO = Buffer.from('audio-chunk').toString('base64');

function mkTarget() {
  const target = mkTmpDir('sfvc-lt-routes-');
  return target;
}

test('letsTalkRoutes: module exports route helpers and body limit', () => {
  assert.equal(typeof isLetsTalkPath, 'function');
  assert.equal(typeof processLetsTalkTurn, 'function');
  assert.equal(LETS_TALK_TURN_MAX_BODY_BYTES, 8 * 1024 * 1024);
});

test('letsTalkRoutes: compiled module exposes __esModule interop flag', () => {
  const mod = require('../out/bridge/letsTalkRoutes');
  assert.equal(mod.__esModule, true);
  assert.equal(Object.getOwnPropertyDescriptor(mod, '__esModule')?.value, true);
});

test('isLetsTalkPath matches shell routes only', () => {
  assert.equal(isLetsTalkPath('/lets-talk'), true);
  assert.equal(isLetsTalkPath('/lets-talk?token=x'), true);
  assert.equal(isLetsTalkPath('/lets-talk/turn'), false);
  assert.equal(isLetsTalkPath('/console'), false);
});

test('isLetsTalkTurnRoute requires POST on turn path', () => {
  const post = { method: 'POST' };
  const get = { method: 'GET' };
  assert.equal(isLetsTalkTurnRoute(post, '/lets-talk/turn'), true);
  assert.equal(isLetsTalkTurnRoute(post, '/lets-talk/turn?bearer=x'), true);
  assert.equal(isLetsTalkTurnRoute(get, '/lets-talk/turn'), false);
  assert.equal(isLetsTalkTurnRoute(post, '/lets-talk/new-session'), false);
  assert.equal(isLetsTalkTurnRoute(post, '/lets-talk'), false);
});

test('isLetsTalkNewSessionRoute requires POST on new-session path', () => {
  const post = { method: 'POST' };
  const get = { method: 'GET' };
  assert.equal(isLetsTalkNewSessionRoute(post, '/lets-talk/new-session'), true);
  assert.equal(isLetsTalkNewSessionRoute(post, '/lets-talk/new-session?token=x'), true);
  assert.equal(isLetsTalkNewSessionRoute(get, '/lets-talk/new-session'), false);
  assert.equal(isLetsTalkNewSessionRoute(post, '/lets-talk/turn'), false);
  assert.equal(isLetsTalkNewSessionRoute(post, '/lets-talk'), false);
});

test('createLetsTalkWriteRoutes wires turn and new-session matchers', () => {
  const target = mkTarget();
  const routes = createLetsTalkWriteRoutes(
    { agentSession: createMockCursorBridgeAgentSession(target) },
    async () => null,
    () => true,
    () => {}
  );
  assert.equal(routes.length, 2);
  assert.equal(routes[0].matches({ method: 'POST' }, '/lets-talk/turn'), true);
  assert.equal(routes[0].matches({ method: 'GET' }, '/lets-talk/turn'), false);
  assert.equal(routes[1].matches({ method: 'POST' }, '/lets-talk/new-session'), true);
  assert.equal(routes[1].matches({ method: 'POST' }, '/lets-talk/turn'), false);
});

test('createLetsTalkTurnHandler skips work when auth fails', async () => {
  const target = mkTarget();
  let sttCalls = 0;
  let bodyRead = false;
  const handler = createLetsTalkTurnHandler(
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => {
        sttCalls += 1;
        return { kind: 'ok', transcript: 'hi' };
      },
    },
    async () => {
      bodyRead = true;
      return { audioBase64: SAMPLE_AUDIO };
    },
    (_req, res) => {
      res.end();
      return false;
    },
    () => {
      throw new Error('respond must not run without auth');
    }
  );
  await new Promise((resolve) => {
    handler({ method: 'POST' }, { end: resolve }, '/lets-talk/turn', { devices: [] });
  });
  assert.equal(bodyRead, false);
  assert.equal(sttCalls, 0);
});

test('createLetsTalkTurnHandler passes body shape error to readBody', async () => {
  const target = mkTarget();
  let shapeErrorReason;
  const handler = createLetsTalkTurnHandler(
    { agentSession: createMockCursorBridgeAgentSession(target) },
    async (_req, _res, maxBytes, _isShape, reason) => {
      shapeErrorReason = reason;
      assert.equal(maxBytes, LETS_TALK_TURN_MAX_BODY_BYTES);
      return null;
    },
    () => true,
    () => {}
  );
  handler({ method: 'POST' }, { end() {} }, '/lets-talk/turn', { devices: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shapeErrorReason, 'expected a JSON body of {audioBase64, mimeType?}');
});

test('createLetsTalkTurnHandler ignores null validated body', async () => {
  const target = mkTarget();
  let responded = false;
  const handler = createLetsTalkTurnHandler(
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => {
        throw new Error('STT must not run when body validation fails');
      },
    },
    async () => null,
    () => true,
    () => {
      responded = true;
    }
  );
  handler({ method: 'POST' }, { end() {} }, '/lets-talk/turn', { devices: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(responded, false);
});

test('createLetsTalkTurnHandler responds with turn result when auth and body succeed', async () => {
  const target = mkTarget();
  const response = await new Promise((resolve) => {
    const handler = createLetsTalkTurnHandler(
      {
        agentSession: createMockCursorBridgeAgentSession(target),
        transcribeAudio: async () => ({ kind: 'ok', transcript: 'ping' }),
        clientTts: true,
      },
      async () => ({ audioBase64: SAMPLE_AUDIO }),
      () => true,
      (_res, status, body) => {
        resolve({ status, body });
      }
    );
    handler({ method: 'POST' }, { end() {} }, '/lets-talk/turn', { devices: [] });
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.state, 'ready');
  assert.match(response.body.replyText, /\bping\b/);
});

test('createLetsTalkNewSessionHandler skips reset when auth fails', async () => {
  const target = mkTarget();
  const session = createMockCursorBridgeAgentSession(target);
  let resetCalls = 0;
  session.resetSession = async () => {
    resetCalls += 1;
    return { agentId: 'agent-1' };
  };
  const handler = createLetsTalkNewSessionHandler(
    { agentSession: session },
    (_req, res) => {
      res.end();
      return false;
    },
    () => {
      throw new Error('respond must not run without auth');
    }
  );
  await new Promise((resolve) => {
    handler({ method: 'POST' }, { end: resolve }, '/lets-talk/new-session', { devices: [] });
  });
  assert.equal(resetCalls, 0);
});

test('createLetsTalkNewSessionHandler returns success and agentId', async () => {
  const target = mkTarget();
  const session = createMockCursorBridgeAgentSession(target);
  session.resetSession = async () => ({ agentId: 'agent-42' });
  const response = await new Promise((resolve) => {
    const handler = createLetsTalkNewSessionHandler(
      { agentSession: session },
      () => true,
      (_res, status, body) => {
        resolve({ status, body });
      }
    );
    handler({ method: 'POST' }, { end() {} }, '/lets-talk/new-session', { devices: [] });
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.agentId, 'agent-42');
});

test('createLetsTalkNewSessionHandler nulls missing agentId after reset', async () => {
  const target = mkTarget();
  const session = createMockCursorBridgeAgentSession(target);
  session.resetSession = async () => ({ agentId: undefined });
  const response = await new Promise((resolve) => {
    const handler = createLetsTalkNewSessionHandler(
      { agentSession: session },
      () => true,
      (_res, status, body) => {
        resolve({ status, body });
      }
    );
    handler({ method: 'POST' }, { end() {} }, '/lets-talk/new-session', { devices: [] });
  });
  assert.equal(response.body.success, true);
  assert.equal(response.body.agentId, null);
});

test('processLetsTalkTurn: default speech language auto-detects from transcript', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'bonjour' }),
      clientTts: true,
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.speechLocale, 'fr-FR');
});

test('processLetsTalkTurn: omitted speechLanguage defaults to auto', async () => {
  const target = mkTarget();
  const letsTalkCore = require('../out/bridge/letsTalkCore');
  const original = letsTalkCore.resolveTurnSpeechLanguage;
  const observedSettings = [];
  letsTalkCore.resolveTurnSpeechLanguage = (setting, transcript) => {
    observedSettings.push(setting);
    return original(setting, transcript);
  };
  try {
    await processLetsTalkTurn(
      { audioBase64: SAMPLE_AUDIO },
      {
        agentSession: createMockCursorBridgeAgentSession(target),
        transcribeAudio: async () => ({ kind: 'ok', transcript: 'hello' }),
        clientTts: true,
      }
    );
    assert.ok(observedSettings.length >= 1);
    assert.ok(observedSettings.every((setting) => setting === 'auto'));
  } finally {
    letsTalkCore.resolveTurnSpeechLanguage = original;
  }
});

test('processLetsTalkTurn: forced French language keeps fr-FR for English transcript', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hello there' }),
      clientTts: true,
      speechLanguage: 'fr',
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.speechLocale, 'fr-FR');
});

test('processLetsTalkTurn: forced English language keeps en-US for French transcript', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'bonjour' }),
      clientTts: true,
      speechLanguage: 'en',
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.speechLocale, 'en-US');
});

test('processLetsTalkTurn: bad audio is recoverable ready state', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: '' },
    { agentSession: createMockCursorBridgeAgentSession(target) }
  );
  assert.equal(result.success, false);
  assert.equal(result.recoverable, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.reason, unprocessableAudioMessage());
});

test('processLetsTalkTurn: missing STT is recoverable ready state', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    { agentSession: createMockCursorBridgeAgentSession(target) }
  );
  assert.equal(result.success, false);
  assert.match(result.reason, /speech-to-text is not configured/i);
  assert.equal(result.recoverable, true);
  assert.equal(result.state, 'ready');
});

test('processLetsTalkTurn: unprocessable STT is recoverable ready state', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'unprocessable' }),
    }
  );
  assert.equal(result.success, false);
  assert.equal(result.recoverable, true);
  assert.equal(result.state, 'ready');
});

test('processLetsTalkTurn: STT fallback maps non-ok results without failure mapping', async () => {
  const target = mkTarget();
  const letsTalkCore = require('../out/bridge/letsTalkCore');
  const original = letsTalkCore.sttFailureForOutcome;
  letsTalkCore.sttFailureForOutcome = () => null;
  try {
    const result = await processLetsTalkTurn(
      { audioBase64: SAMPLE_AUDIO },
      {
        agentSession: createMockCursorBridgeAgentSession(target),
        transcribeAudio: async () => ({ kind: 'unprocessable' }),
      }
    );
    assert.equal(result.success, false);
    assert.equal(result.reason, unprocessableAudioMessage());
    assert.equal(result.recoverable, true);
    assert.equal(result.state, 'ready');
  } finally {
    letsTalkCore.sttFailureForOutcome = original;
  }
});

test('processLetsTalkTurn: sttAttempts increments only on transient failure', async () => {
  const target = mkTarget();
  const sttAttempts = { transientFailuresBeforeSuccess: 0 };
  await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hi' }),
      clientTts: true,
    },
    sttAttempts
  );
  assert.equal(sttAttempts.transientFailuresBeforeSuccess, 0);

  await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'transient-failure' }),
    },
    sttAttempts
  );
  assert.equal(sttAttempts.transientFailuresBeforeSuccess, 1);
});

test('processLetsTalkTurn: missing TTS without clientTts fails recoverably', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hi' }),
    }
  );
  assert.equal(result.success, false);
  assert.match(result.reason, /text-to-speech is not configured/i);
  assert.equal(result.recoverable, true);
  assert.equal(result.state, 'ready');
});

test('processLetsTalkTurn: client TTS succeeds with ready state and no server audio', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hi' }),
      clientTts: true,
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.clientTts, true);
  assert.equal(result.replyAudioBase64, undefined);
});

test('processLetsTalkTurn: TTS failure is recoverable ready state', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hi' }),
      synthesizeSpeech: async () => ({ kind: 'failure' }),
    }
  );
  assert.equal(result.success, false);
  assert.match(result.reason, /text-to-speech failed/i);
  assert.equal(result.recoverable, true);
  assert.equal(result.state, 'ready');
});

test('processLetsTalkTurn: Error agent throw is recoverable ready state', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: {
        readAgentId: () => undefined,
        resetSession: async () => ({ agentId: undefined }),
        promptAgent: async () => {
          throw new Error('cursor offline');
        },
      },
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hi' }),
    }
  );
  assert.equal(result.success, false);
  assert.match(result.reason, /cursor offline/i);
  assert.equal(result.recoverable, true);
  assert.equal(result.state, 'ready');
});

test('processLetsTalkTurn: non-Error agent throw uses generic reason', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: {
        readAgentId: () => undefined,
        resetSession: async () => ({ agentId: undefined }),
        promptAgent: async () => {
          throw 'not-an-error-object';
        },
      },
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hi' }),
    }
  );
  assert.equal(result.success, false);
  assert.equal(result.reason, 'cursor agent error');
  assert.equal(result.recoverable, true);
  assert.equal(result.state, 'ready');
});

test('processLetsTalkTurn: server TTS success includes audio and ready state', async () => {
  const target = mkTarget();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hello' }),
      synthesizeSpeech: async () => ({ kind: 'ok', audio: Buffer.from('speech') }),
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.state, 'ready');
  assert.ok(result.replyAudioBase64);
  assert.equal(result.clientTts, undefined);
});
