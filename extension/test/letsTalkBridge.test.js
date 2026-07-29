const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridge } = require('../out/bridge/bridgeServer');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const { processLetsTalkTurn } = require('../out/bridge/letsTalkRoutes');

const TOKEN = 'lets-talk-bridge-token';
const SAMPLE_AUDIO = Buffer.from('audio-chunk').toString('base64');

function mkTmp() {
  const target = mkTmpDir('sfvc-lets-talk-bridge-');
  fs.mkdirSync(path.join(target, '.swarmforge', 'operator'), { recursive: true });
  return target;
}

function withBridge(targetPath, letsTalk, fn) {
  return startBridge(targetPath, path.join(targetPath, 'runs.jsonl'), TOKEN, { letsTalk }).then(async (handle) => {
    try {
      return await fn(handle);
    } finally {
      handle.stop();
    }
  });
}

function controlAuthHeaders(token = TOKEN) {
  return {
    authorization: `Bearer ${token}`,
    'x-control-token': token,
    'content-type': 'application/json',
  };
}

function buildMocks(targetPath, ctx = {}) {
  const agentSession = createMockCursorBridgeAgentSession(targetPath);
  return {
    agentSession,
    transcribeAudio: async () => {
      ctx.sttCalls = (ctx.sttCalls ?? 0) + 1;
      return { kind: 'ok', transcript: ctx.transcript ?? 'remember the code word ALPHA' };
    },
    synthesizeSpeech: async (text) => {
      ctx.ttsCalls = (ctx.ttsCalls ?? 0) + 1;
      return { kind: 'ok', audio: Buffer.from(`audio:${text}`) };
    },
  };
}

test("lets-talk Mini App shell is served without auth", async () => {
  const target = mkTmp();
  await withBridge(target, buildMocks(target), async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Let's Talk/);
    assert.match(body, /data-testid="lets-talk-record"/);
    assert.match(body, /data-testid="lets-talk-pause-all"/);
    assert.match(body, /data-testid="lets-talk-new-session"/);
    assert.match(body, /data-testid="lets-talk-hands-free"/);
    assert.match(body, /data-testid="lets-talk-mute"/);
    assert.match(body, /data-testid="lets-talk-wake-lock-toggle"/);
    assert.match(body, /data-testid="lets-talk-bridge-health"/);
    assert.match(body, /scheduleHandsFreeListen/);
    assert.match(body, /pollBridgeHealth/);
    assert.match(body, /ensureSpeechVoices/);
    assert.match(body, /MUTE_STORAGE_KEY/);
    assert.match(body, /stopPlaybackNow/);
    assert.match(body, /setPauseAll/);
    assert.match(body, /data-bridge-state/);
    assert.match(body, /rel="manifest"/);
    assert.match(body, /apple-mobile-web-app-capable/);
    assert.match(body, /serviceWorker/);
    assert.match(body, /data-testid="lets-talk-pwa-install"/);
    assert.match(body, /lets-talk-bearer/);
    assert.match(body, /localStorage\.setItem\(AUTH_STORAGE_KEY/);
    assert.match(body, /localStorage\.getItem\(AUTH_STORAGE_KEY/);
    assert.match(body, /lets-talk-manifest/);
    assert.match(body, /writeAuthCookie/);
    assert.match(body, /manifest\.json' \+ q/);
  });
});

test("lets-talk PWA manifest is served at /lets-talk/manifest.json", async () => {
  const target = mkTmp();
  await withBridge(target, buildMocks(target), async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/manifest.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
    const manifest = await res.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/lets-talk');
    assert.equal(manifest.scope, '/lets-talk');
  });
});

test("lets-talk PWA manifest start_url includes bearer when requested", async () => {
  const target = mkTmp();
  await withBridge(target, buildMocks(target), async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/manifest.json?bearer=test-token-123`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const manifest = await res.json();
    assert.equal(manifest.start_url, '/lets-talk?bearer=test-token-123');
  });
});

test("lets-talk service worker is served at /lets-talk/sw.js", async () => {
  const target = mkTmp();
  await withBridge(target, buildMocks(target), async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/sw.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/javascript/);
    const body = await res.text();
    assert.match(body, /skipWaiting/);
  });
});

test('console menu links to the lets-talk screen', async () => {
  const target = mkTmp();
  await withBridge(target, buildMocks(target), async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Let's Talk/);
    assert.match(body, /\/lets-talk/);
    assert.match(body, /data-testid="lets-talk"/);
  });
});

test('lets-talk turn route requires control auth (401 without token)', async () => {
  const target = mkTmp();
  const counters = {};
  await withBridge(target, buildMocks(target, counters), async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audioBase64: SAMPLE_AUDIO }),
    });
    assert.equal(res.status, 401);
    assert.equal(counters.sttCalls ?? 0, 0);
  });
});

test('lets-talk turn completes with transcript, reply text, and audio', async () => {
  const target = mkTmp();
  const counters = { transcript: 'hello there' };
  await withBridge(target, buildMocks(target, counters), async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/turn?bearer=${TOKEN}`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ audioBase64: SAMPLE_AUDIO, mimeType: 'audio/webm' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.state, 'ready');
    assert.ok(body.replyText);
    assert.ok(body.replyAudioBase64);
    assert.ok(body.agentId);
    assert.equal(counters.sttCalls, 1);
  });
});

test('lets-talk turn route accepts bearer query param without auth headers', async () => {
  const target = mkTmp();
  const counters = { transcript: 'ping' };
  await withBridge(target, buildMocks(target, counters), async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/turn?bearer=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audioBase64: SAMPLE_AUDIO }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });
});

test('lets-talk new-session clears remembered context', async () => {
  const target = mkTmp();
  const counters = {};
  const mocks = buildMocks(target, counters);
  await withBridge(target, mocks, async (handle) => {
    const turn1 = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/turn?token=${TOKEN}`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ audioBase64: SAMPLE_AUDIO }),
    });
    const first = await turn1.json();
    assert.equal(first.success, true);

    const reset = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/new-session?token=${TOKEN}`, {
      method: 'POST',
      headers: controlAuthHeaders(),
    });
    assert.equal(reset.status, 200);

    counters.transcript = 'what was the code word';
    const turn2 = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/turn?token=${TOKEN}`, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ audioBase64: SAMPLE_AUDIO }),
    });
    const second = await turn2.json();
    assert.equal(second.success, true);
    assert.match(second.replyText, /do not have a code word/i);
  });
});

test('processLetsTalkTurn: bad audio is recoverable without agent prompt', async () => {
  const target = mkTmp();
  const counters = {};
  const result = await processLetsTalkTurn(
    { audioBase64: '' },
    { agentSession: createMockCursorBridgeAgentSession(target), ...buildMocks(target, counters) }
  );
  assert.equal(result.success, false);
  assert.equal(result.recoverable, true);
  assert.equal(counters.sttCalls ?? 0, 0);
});

test('processLetsTalkTurn: transient STT failure surfaces retry state', async () => {
  const target = mkTmp();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'transient-failure' }),
      synthesizeSpeech: async () => ({ kind: 'ok', audio: Buffer.from('x') }),
    }
  );
  assert.equal(result.success, false);
  assert.equal(result.state, 'error');
  assert.equal(result.recoverable, true);
});

test('processLetsTalkTurn: missing STT adapter is recoverable', async () => {
  const target = mkTmp();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    { agentSession: createMockCursorBridgeAgentSession(target) }
  );
  assert.equal(result.success, false);
  assert.match(result.reason, /speech-to-text is not configured/i);
});

test('processLetsTalkTurn: client TTS mode succeeds without server synthesizeSpeech', async () => {
  const target = mkTmp();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hi' }),
      clientTts: true,
    }
  );
  assert.equal(result.success, true);
  assert.match(result.replyText, /You said:.*\bhi\b/s);
  assert.match(result.replySpeechText, /\bhi\b/);
  assert.equal(result.speechLocale, 'en-US');
  assert.equal(result.clientTts, true);
  assert.equal(result.replyAudioBase64, undefined);
});

test('processLetsTalkTurn: auto mode uses French locale for French transcript', async () => {
  const target = mkTmp();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'bonjour' }),
      clientTts: true,
      speechLanguage: 'auto',
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.speechLocale, 'fr-FR');
});

test('processLetsTalkTurn: client TTS mode strips markdown from replySpeechText', async () => {
  const target = mkTmp();
  const session = createMockCursorBridgeAgentSession(target);
  session.promptAgent = async () => ({ replyText: '**Ready** — use `code`.', agentId: 'agent-1' });
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: session,
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'status' }),
      clientTts: true,
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.replyText, '**Ready** — use `code`.');
  assert.equal(result.replySpeechText, 'Ready — use code.');
});

test('processLetsTalkTurn: replySpeechText normalizes HR and list edge cases', async () => {
  const target = mkTmp();
  const session = createMockCursorBridgeAgentSession(target);
  session.promptAgent = async () => ({
    replyText: 'foo--bar\n- item\n| --- | --- |',
    agentId: 'agent-1',
  });
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: session,
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'status' }),
      clientTts: true,
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.replySpeechText, 'foo bar\nitem');
});

test('processLetsTalkTurn: TTS failure is recoverable', async () => {
  const target = mkTmp();
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
});

test('processLetsTalkTurn: increments transient STT attempt counter', async () => {
  const target = mkTmp();
  const sttAttempts = { transientFailuresBeforeSuccess: 0 };
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

test('processLetsTalkTurn: agent errors are recoverable', async () => {
  const target = mkTmp();
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
      synthesizeSpeech: async () => ({ kind: 'ok', audio: Buffer.from('x') }),
    }
  );
  assert.equal(result.success, false);
  assert.match(result.reason, /cursor offline/i);
});

test('processLetsTalkTurn: successful turns call onTurnSuccess with reply text', async () => {
  const target = mkTmp();
  const seen = [];
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hello' }),
      clientTts: true,
      onTurnSuccess: async (turn) => {
        seen.push(turn.replyText);
      },
    }
  );
  assert.equal(result.success, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], result.replyText);
});

test('processLetsTalkTurn: onTurnSuccess failure is ignored', async () => {
  const target = mkTmp();
  const result = await processLetsTalkTurn(
    { audioBase64: SAMPLE_AUDIO },
    {
      agentSession: createMockCursorBridgeAgentSession(target),
      transcribeAudio: async () => ({ kind: 'ok', transcript: 'hello' }),
      clientTts: true,
      onTurnSuccess: async () => {
        throw new Error('mirror failed');
      },
    }
  );
  assert.equal(result.success, true);
});
