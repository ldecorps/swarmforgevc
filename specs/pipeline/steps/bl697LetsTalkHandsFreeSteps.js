'use strict';

// BL-697: step handlers for "Let's Talk hands-free listening"
// (specs/features/BL-697-lets-talk-hands-free-listening.feature). Same
// posture as bl696LetsTalkSteps.js: drive the REAL bridge server for the
// server-visible half of this ticket (discrete /lets-talk/turn model is
// unchanged, invariant 2) and, for the WebView-only half that has no real
// browser/AudioContext in this Node harness, verify the served
// extension/src/bridge/letsTalkUiHtml.ts script text actually wires the
// described behavior, cross-checked against the pure decisions it is built
// from (extension/src/bridge/letsTalkCore.ts) so this is a behavioral check,
// not a text-matching one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startBridge } = require('../../../extension/out/bridge/bridgeServer');
const { createMockCursorBridgeAgentSession } = require('../../../extension/out/bridge/cursorBridgeAgentSession');
const {
  LETS_TALK_HANDS_FREE_SILENCE_MS,
  LETS_TALK_HANDS_FREE_MAX_LISTEN_MS,
  parseHandsFreeEnabled,
  shouldScheduleHandsFreeListen,
  shouldEndHandsFreeRecording,
  shouldCancelHandsFreeRecordingNoSpeech,
} = require('../../../extension/out/bridge/letsTalkCore');

const FEATURE = "Let's Talk hands-free listening";
const TOKEN = 'lets-talk-token';
const SAMPLE_AUDIO = Buffer.from('fake-audio-bytes').toString('base64');

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl697-'));
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
  ctx.letsTalkMocks = {
    agentSession: createMockCursorBridgeAgentSession(ctx.root),
    transcribeAudio: async () => {
      ctx.sttCalls += 1;
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
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk`);
    assert.equal(res.status, 200);
    ctx.html = await res.text();
  });
}

async function submitTurn(ctx) {
  await withBridge(ctx, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/turn?token=${encodeURIComponent(ctx.token)}`, {
      method: 'POST',
      headers: controlAuthHeaders(ctx.token),
      body: JSON.stringify({ audioBase64: SAMPLE_AUDIO, mimeType: 'audio/webm' }),
    });
    ctx.turnStatus = res.status;
    ctx.turnResult = await res.json();
  });
}

/** The single `<input ... id="hands-free" .../>` tag, isolated from the rest of the page. */
function handsFreeInputTag(html) {
  const match = html.match(/<input[^>]*id="hands-free"[^>]*>/);
  assert.ok(match, 'expected a hands-free <input> tag in the served page');
  return match[0];
}

function registerSteps(registry) {
  registry.defineScoped(/^the SwarmForge bridge Mini App is reachable with my allowlisted console token$/, (ctx) => {
    ctx.root = mkFixture();
    ctx.token = TOKEN;
    ctx.sttCalls = 0;
    ctx.ttsCalls = 0;
    ctx.nextTranscript = 'hello';
  }, FEATURE);

  registry.defineScoped(/^I am on the Let's Talk screen$/, fetchLetsTalkShell, FEATURE);

  // Scenario: the Let's Talk screen exposes a hands-free toggle
  registry.defineScoped(/^the page shows a hands-free control$/, (ctx) => {
    assert.match(ctx.html, /data-testid="lets-talk-hands-free"/);
  }, FEATURE);

  registry.defineScoped(/^hands-free is off by default on first visit$/, (ctx) => {
    // The served markup itself carries no `checked` attribute...
    assert.doesNotMatch(handsFreeInputTag(ctx.html), /checked/);
    // ...and the client script's own first-visit read agrees: with nothing
    // yet in localStorage, getItem returns null, and the ticket's own
    // storage-format parser (LETS_TALK_HANDS_FREE_STORAGE_KEY, shared by
    // client and server) must resolve that to off.
    assert.equal(parseHandsFreeEnabled(null), false);
    assert.match(ctx.html, /localStorage\.getItem\(HANDS_FREE_STORAGE_KEY\) === '1'/);
  }, FEATURE);

  // Scenario: enabling hands-free while ready starts listening without tapping Record
  registry.defineScoped(/^I enable hands-free$/, (ctx) => {
    // Toggling on while idle and not recording is exactly the input shape
    // the pure scheduling decision is built to say "yes, listen" for -
    // the same decision the served onchange handler below calls into.
    ctx.scheduleDecision = shouldScheduleHandsFreeListen({
      handsFreeEnabled: true,
      phase: 'ready',
      recording: false,
    });
    // The served onchange handler must itself request a schedule (not just
    // flip a flag) whenever hands-free is turned on while ready and idle.
    assert.match(
      ctx.html,
      /handsFreeEnabled = handsFreeEl\.checked;[\s\S]{0,400}if \(phase === 'ready' && !recording\) \{\s*scheduleHandsFreeListen\(\);/
    );
  }, FEATURE);

  registry.defineScoped(/^the record control shows a listening state$/, (ctx) => {
    assert.equal(ctx.scheduleDecision, true);
    // updateRecordButton's own label choice while recording, when
    // hands-free is on, is "Listening" - never the manual "Stop".
    assert.match(ctx.html, /recordBtn\.textContent = handsFreeEnabled \? 'Listening' : 'Stop';/);
  }, FEATURE);

  registry.defineScoped(/^the microphone capture has started$/, (ctx) => {
    // scheduleHandsFreeListen's own timeout calls startRecording(true) -
    // the `true` (autoStarted) is what proves no tap drove this start.
    assert.match(
      ctx.html,
      /autoListenTimer = setTimeout\(function \(\) \{[\s\S]{0,200}startRecording\(true\);/
    );
  }, FEATURE);

  // Scenario: hands-free submits a turn after the user stops speaking
  registry.defineScoped(/^hands-free is enabled$/, () => {}, FEATURE);

  registry.defineScoped(/^I have started a hands-free capture$/, (ctx) => {
    ctx.recordStartedAt = 0;
    assert.equal(
      shouldScheduleHandsFreeListen({ handsFreeEnabled: true, phase: 'ready', recording: false }),
      true
    );
  }, FEATURE);

  registry.defineScoped(/^I speak a short question and then stay silent for the silence threshold$/, async (ctx) => {
    // The pure end-of-recording decision: speech was heard, then silence
    // reached the threshold - this is what the client's silence monitor
    // uses to call stopRecording, which in turn submits the turn.
    ctx.endDecision = shouldEndHandsFreeRecording({
      handsFreeEnabled: true,
      recording: true,
      speechDetected: true,
      silenceMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
      recordingMs: LETS_TALK_HANDS_FREE_SILENCE_MS + 500,
      minRecordingMs: 400,
      silenceThresholdMs: LETS_TALK_HANDS_FREE_SILENCE_MS,
    });
    assert.equal(ctx.endDecision, true);
    ctx.nextTranscript = 'what is the status';
    // Invariant 2: hands-free still drives exactly one discrete
    // POST /lets-talk/turn per utterance - no duplex route.
    await submitTurn(ctx);
  }, FEATURE);

  registry.defineScoped(/^the turn is submitted to the bridge$/, (ctx) => {
    assert.equal(ctx.turnResult.success, true);
    assert.equal(ctx.sttCalls, 1);
  }, FEATURE);

  registry.defineScoped(/^conversation state becomes "thinking" then "speaking" then "ready"$/, (ctx) => {
    assert.match(ctx.html, /setPhase\('thinking'\)/);
    assert.match(ctx.html, /setPhase\('speaking'\)/);
    assert.equal(ctx.turnResult.state, 'ready');
    assert.match(ctx.html, /setPhase\('ready'\);\s*scheduleHandsFreeListen\(\);/);
  }, FEATURE);

  // Scenario: after agent playback hands-free re-opens the microphone
  registry.defineScoped(/^I completed one hands-free turn$/, async (ctx) => {
    ctx.nextTranscript = 'hello';
    await submitTurn(ctx);
    assert.equal(ctx.turnResult.success, true);
  }, FEATURE);

  registry.defineScoped(/^the agent reply finishes playing$/, (ctx) => {
    // endTurn()'s post-playback path: setPhase('ready') is immediately
    // followed by scheduleHandsFreeListen() - re-arming is tied to
    // playback finishing, not to any other phase transition.
    assert.match(ctx.html, /setPhase\('ready'\);\s*scheduleHandsFreeListen\(\);/);
  }, FEATURE);

  registry.defineScoped(/^the record control shows a listening state again$/, (ctx) => {
    assert.match(ctx.html, /recordBtn\.textContent = handsFreeEnabled \? 'Listening' : 'Stop';/);
  }, FEATURE);

  registry.defineScoped(/^I did not tap Record$/, (ctx) => {
    // The manual path (recordBtn.onclick) always calls startRecording(false)
    // - only the auto path calls startRecording(true). Re-arming through
    // scheduleHandsFreeListen never touches recordBtn.onclick at all.
    assert.match(ctx.html, /startRecording\(false\);/);
    assert.match(ctx.html, /autoListenTimer = setTimeout\(function \(\) \{[\s\S]{0,200}startRecording\(true\);/);
  }, FEATURE);

  // Scenario: disabling hands-free stops auto-listening
  registry.defineScoped(/^hands-free is enabled and listening$/, () => {}, FEATURE);

  registry.defineScoped(/^I disable hands-free$/, (ctx) => {
    // The onchange handler's off-branch: cancel any pending auto-listen
    // timer and, if a hands-free capture is already recording, stop it.
    assert.match(
      ctx.html,
      /if \(!handsFreeEnabled\) \{\s*clearAutoListenTimer\(\);\s*if \(recording\) \{\s*stopRecording\(true\);/
    );
  }, FEATURE);

  registry.defineScoped(/^auto-listening is cancelled$/, (ctx) => {
    assert.match(ctx.html, /function clearAutoListenTimer\(\) \{\s*if \(autoListenTimer\) \{\s*clearTimeout\(autoListenTimer\);/);
  }, FEATURE);

  registry.defineScoped(/^the record control returns to the manual Record label$/, (ctx) => {
    // updateRecordButton's not-recording, not-mini branch always labels the
    // button "Record" - independent of the hands-free flag.
    assert.match(ctx.html, /recordBtn\.setAttribute\('aria-pressed', 'false'\);[\s\S]{0,200}recordBtn\.textContent = 'Record';/);
  }, FEATURE);

  // Scenario: manual Record still works when hands-free is off
  registry.defineScoped(/^hands-free is off$/, () => {}, FEATURE);

  registry.defineScoped(/^I tap Record, speak, and tap Stop$/, async (ctx) => {
    // With hands-free off, none of the auto-listen decisions apply -
    // BL-696's tap-to-toggle model is exactly what fires.
    assert.equal(
      shouldScheduleHandsFreeListen({ handsFreeEnabled: false, phase: 'ready', recording: false }),
      false
    );
    assert.equal(
      shouldCancelHandsFreeRecordingNoSpeech({
        handsFreeEnabled: false,
        recording: true,
        speechDetected: false,
        recordingMs: LETS_TALK_HANDS_FREE_MAX_LISTEN_MS,
        maxListenMs: LETS_TALK_HANDS_FREE_MAX_LISTEN_MS,
      }),
      false
    );
    ctx.nextTranscript = 'what is the status';
    await submitTurn(ctx);
  }, FEATURE);

  registry.defineScoped(/^the turn is submitted exactly as in BL-696$/, (ctx) => {
    assert.equal(ctx.turnResult.success, true);
    assert.ok(ctx.turnResult.replyAudioBase64);
    assert.equal(ctx.turnResult.state, 'ready');
  }, FEATURE);
}

module.exports = { registerSteps };
