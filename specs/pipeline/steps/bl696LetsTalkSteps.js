'use strict';

// BL-696: step handlers for Let's Talk discrete audio turns on the console
// Mini App. Drives the REAL bridge server (extension/out/bridge/bridgeServer)
// with injectable STT/TTS/agent-session mocks — same posture as bl538/gh23.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');
const { createMockCursorBridgeAgentSession } = require('../../../extension/out/bridge/cursorBridgeAgentSession');
const { decideInboundAction } = require('../../../extension/out/tools/telegramCursorBridgeCore');

const FEATURE = "Let's Talk — discrete audio turns with the Cursor agent on the Console Mini App";
const TOKEN = 'lets-talk-token';
const CHAT_ID = '-100123';
const PRINCIPAL_ID = 42;
const CURSOR_TOPIC_ID = 7501;
const SAMPLE_AUDIO = Buffer.from('fake-audio-bytes').toString('base64');

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl696-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function controlAuthHeaders(token = TOKEN) {
  return {
    authorization: `Bearer ${token}`,
    'x-control-token': token,
    'content-type': 'application/json',
  };
}

function buildLetsTalkMocks(ctx) {
  if (ctx.letsTalkMocks) {
    return ctx.letsTalkMocks;
  }
  const agentSession = createMockCursorBridgeAgentSession(ctx.root);
  ctx.letsTalkMocks = {
    agentSession,
    transcribeAudio: async (_bytes, _mimeType) => {
      ctx.sttCalls += 1;
      if (ctx.sttMode === 'transient-failure') {
        ctx.sttMode = 'ok';
        return { kind: 'transient-failure' };
      }
      if (ctx.sttMode === 'unprocessable') {
        return { kind: 'unprocessable' };
      }
      return { kind: 'ok', transcript: ctx.nextTranscript ?? 'hello' };
    },
    synthesizeSpeech: async (text) => {
      ctx.ttsCalls += 1;
      ctx.lastTtsText = text;
      return { kind: 'ok', audio: Buffer.from(`tts:${text}`) };
    },
  };
  return ctx.letsTalkMocks;
}

async function withBridge(ctx, fn) {
  const handle = await startBridge(ctx.root, path.join(ctx.root, 'runs.jsonl'), TOKEN, {
    letsTalk: buildLetsTalkMocks(ctx),
  });
  try {
    return await fn(handle);
  } finally {
    handle.stop();
  }
}

async function fetchLetsTalkShell(ctx) {
  await withBridge(ctx, async (handle) => {
    const base = `http://127.0.0.1:${handle.port}`;
    const consoleRes = await fetch(`${base}/console`);
    assert.equal(consoleRes.status, 200);
    ctx.consoleHtml = await consoleRes.text();
    const htmlRes = await fetch(`${base}/lets-talk`);
    assert.equal(htmlRes.status, 200);
    ctx.html = await htmlRes.text();
  });
}

async function submitTurn(ctx, { auth = true, audioBase64 = SAMPLE_AUDIO } = {}) {
  await withBridge(ctx, async (handle) => {
    const headers = auth && ctx.token ? controlAuthHeaders(ctx.token) : { 'content-type': 'application/json' };
    const q = ctx.token ? `?token=${encodeURIComponent(ctx.token)}` : '';
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/turn${q}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ audioBase64, mimeType: 'audio/webm' }),
    });
    ctx.turnStatus = res.status;
    ctx.turnResult = await res.json();
    if (ctx.turnResult.success) {
      ctx.lastAgentId = ctx.turnResult.agentId;
      if (!ctx.firstAgentId) {
        ctx.firstAgentId = ctx.turnResult.agentId;
      }
    }
  });
}

async function submitTurnWithClientRetry(ctx) {
  ctx.phaseTrace = [];
  let attempt = 0;
  while (attempt < 3) {
    await submitTurn(ctx);
    if (ctx.turnResult.success) {
      ctx.phaseTrace.push('thinking', 'speaking', 'ready');
      return;
    }
    if (ctx.turnResult.recoverable && ctx.turnResult.state === 'error') {
      ctx.phaseTrace.push('error', 'thinking');
      attempt += 1;
      continue;
    }
    break;
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^the SwarmForge bridge Mini App is reachable with my allowlisted console token$/, (ctx) => {
    ctx.root = mkFixture();
    ctx.token = TOKEN;
    ctx.sttCalls = 0;
    ctx.ttsCalls = 0;
    ctx.agentPrompts = 0;
    ctx.sttMode = 'ok';
    ctx.nextTranscript = 'hello';
  }, FEATURE);

  registry.defineScoped(/^the console menu at \/console is available$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /lets-talk/i);
    });
  }, FEATURE);

  registry.defineScoped(/^the Cursor bridge agent session is available$/, () => {}, FEATURE);

  registry.defineScoped(/^I open Let's Talk from the console menu$/, fetchLetsTalkShell, FEATURE);

  registry.defineScoped(/^the page shows a tap-to-toggle record control$/, (ctx) => {
    assert.match(ctx.html, /data-testid="lets-talk-record"/);
    assert.match(ctx.html, /aria-pressed="false"/);
    assert.match(ctx.html, /Record/);
  }, FEATURE);

  registry.defineScoped(/^shows conversation state "([^"]+)"$/, (ctx, state) => {
    assert.match(ctx.html, new RegExp(`data-phase="${state}"`));
    assert.match(ctx.html, new RegExp(`>${state}<`));
  }, FEATURE);

  registry.defineScoped(/^shows a New session control$/, (ctx) => {
    assert.match(ctx.html, /data-testid="lets-talk-new-session"/);
    assert.match(ctx.html, /New session/);
  }, FEATURE);

  registry.defineScoped(/^I am on the Let's Talk screen$/, async (ctx) => {
    await fetchLetsTalkShell(ctx);
  }, FEATURE);

  registry.defineScoped(/^I am on the Let's Talk screen without a valid console token$/, async (ctx) => {
    ctx.token = '';
    await fetchLetsTalkShell(ctx);
  }, FEATURE);

  registry.defineScoped(/^I record a short spoken question and end the turn$/, async (ctx) => {
    ctx.nextTranscript = 'what is the status';
    await submitTurnWithClientRetry(ctx);
  }, FEATURE);

  registry.defineScoped(/^conversation state becomes "thinking" then "speaking"$/, (ctx) => {
    assert.match(ctx.html, /setPhase\('thinking'\)/);
    assert.match(ctx.html, /setPhase\('speaking'\)/);
    assert.equal(ctx.turnResult.success, true);
    assert.ok(ctx.turnResult.replyAudioBase64);
  }, FEATURE);

  registry.defineScoped(/^the page shows a text transcript of the agent reply$/, (ctx) => {
    assert.ok(ctx.turnResult.replyText);
    assert.match(ctx.html, /data-testid="lets-talk-transcript"/);
  }, FEATURE);

  registry.defineScoped(/^I hear the synthesized reply audio for that transcript$/, (ctx) => {
    assert.ok(ctx.turnResult.replyAudioBase64);
    assert.equal(ctx.ttsCalls >= 1, true);
    assert.equal(ctx.lastTtsText, ctx.turnResult.replyText);
  }, FEATURE);

  registry.defineScoped(/^conversation state returns to "ready"$/, (ctx) => {
    assert.equal(ctx.turnResult.state, 'ready');
    assert.match(ctx.html, /setPhase\('ready'\)/);
  }, FEATURE);

  registry.defineScoped(/^I completed one Let's Talk turn asking "([^"]+)"$/, async (ctx, phrase) => {
    ctx.nextTranscript = phrase;
    await submitTurn(ctx);
    assert.equal(ctx.turnResult.success, true);
    ctx.firstAgentId = ctx.turnResult.agentId;
  }, FEATURE);

  registry.defineScoped(/^I record a turn asking "([^"]+)"$/, async (ctx, phrase) => {
    ctx.nextTranscript = phrase;
    await submitTurnWithClientRetry(ctx);
  }, FEATURE);

  registry.defineScoped(/^the agent reply transcript mentions "([^"]+)"$/, (ctx, word) => {
    assert.match(ctx.turnResult.replyText, new RegExp(word, 'i'));
  }, FEATURE);

  registry.defineScoped(/^the reply uses the same Cursor bridge agent session as the first turn$/, (ctx) => {
    assert.equal(ctx.turnResult.agentId, ctx.firstAgentId);
  }, FEATURE);

  registry.defineScoped(/^I tap New session$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const q = `?token=${encodeURIComponent(ctx.token)}`;
      const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/new-session${q}`, {
        method: 'POST',
        headers: controlAuthHeaders(ctx.token),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      ctx.newSessionAgentId = body.agentId;
    });
  }, FEATURE);

  registry.defineScoped(/^the agent reply transcript does not mention "([^"]+)"$/, (ctx, word) => {
    assert.equal(ctx.turnResult.replyText.toLowerCase().includes(word.toLowerCase()), false);
  }, FEATURE);

  registry.defineScoped(/^I attempt to submit a recorded turn$/, async (ctx) => {
    await submitTurn(ctx, { auth: false });
  }, FEATURE);

  registry.defineScoped(/^the request is rejected with unauthorized$/, (ctx) => {
    assert.equal(ctx.turnStatus, 401);
  }, FEATURE);

  registry.defineScoped(/^no speech-to-text or Cursor agent call is made$/, (ctx) => {
    assert.equal(ctx.sttCalls, 0);
    assert.equal(ctx.ttsCalls, 0);
  }, FEATURE);

  registry.defineScoped(/^speech-to-text fails transiently once then succeeds$/, (ctx) => {
    ctx.sttMode = 'transient-failure';
    ctx.nextTranscript = 'hello after retry';
  }, FEATURE);

  registry.defineScoped(/^the page shows conversation state "error" only while retrying$/, (ctx) => {
    assert.deepEqual(ctx.phaseTrace.slice(0, 2), ['error', 'thinking']);
    assert.match(ctx.html, /setPhase\('error'\)/);
  }, FEATURE);

  registry.defineScoped(/^the turn eventually completes with a spoken reply$/, (ctx) => {
    assert.equal(ctx.turnResult.success, true);
    assert.ok(ctx.turnResult.replyAudioBase64);
    assert.equal(ctx.sttCalls >= 2, true);
  }, FEATURE);

  registry.defineScoped(/^I submit a recording with no decodable audio$/, async (ctx) => {
    ctx.sttMode = 'unprocessable';
    await submitTurn(ctx, { audioBase64: Buffer.from('noise').toString('base64') });
  }, FEATURE);

  registry.defineScoped(
    /^the page shows a recoverable error explaining the audio could not be transcribed$/,
    (ctx) => {
      assert.equal(ctx.turnResult.success, false);
      assert.equal(ctx.turnResult.recoverable, true);
      assert.match(ctx.turnResult.reason, /could not be decoded/i);
      assert.match(ctx.html, /could not be decoded/i);
    },
    FEATURE
  );

  registry.defineScoped(/^no Cursor agent prompt is sent$/, (ctx) => {
    assert.equal(ctx.ttsCalls, 0);
    assert.equal(ctx.turnResult.success, false);
  }, FEATURE);

  registry.defineScoped(/^the Cursor bridge agent session has context from a Let's Talk turn$/, async (ctx) => {
    ctx.nextTranscript = 'remember the code word ALPHA';
    await submitTurn(ctx);
    assert.equal(ctx.turnResult.success, true);
    ctx.sharedAgentId = ctx.turnResult.agentId;
  }, FEATURE);

  registry.defineScoped(/^the principal sends a text prompt on the Cursor Remote Telegram topic$/, async (ctx) => {
    const decision = decideInboundAction(
      { fromId: PRINCIPAL_ID, chatId: CHAT_ID, topicId: CURSOR_TOPIC_ID, text: 'what was the code word' },
      PRINCIPAL_ID,
      CHAT_ID,
      CURSOR_TOPIC_ID
    );
    assert.equal(decision.action, 'prompt');
    const mocks = buildLetsTalkMocks(ctx);
    ctx.textReply = await mocks.agentSession.promptAgent(decision.text);
  }, FEATURE);

  registry.defineScoped(/^the text prompt is delivered to the same agent session$/, (ctx) => {
    assert.equal(ctx.textReply.agentId, ctx.sharedAgentId);
  }, FEATURE);

  registry.defineScoped(/^the Telegram reply reflects the shared context$/, (ctx) => {
    assert.match(ctx.textReply.replyText, /ALPHA/i);
  }, FEATURE);
}

module.exports = { registerSteps };
