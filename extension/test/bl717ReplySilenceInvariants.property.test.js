const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const { processLetsTalkTurn } = require('../out/bridge/letsTalkRoutes');
const { LETS_TALK_EMPTY_REPLY_FALLBACK_TEXT } = require('../out/bridge/letsTalkCore');

// BL-717 declared invariants (backlog/active/BL-717-bubble-silent-return-after-hold-music.yaml):
// 1. No terminal branch of a hold-music turn is silent: every path that ends
//    the working interval speaks either the real reply or an explicit
//    failure line.
// 2. The fallback line is spoken only when no real speakable reply is
//    available; it never masks, truncates, or replaces a reply that could
//    have played.
// Coder-authored property tests per BL-654; runs only via npm run
// test:properties. This covers the bridge (host) half of the guarantee —
// android/app/src/test/.../ReplyPlaybackDecisionPropertyTest.kt covers the
// device half, which the node acceptance runner cannot reach.

function mkRoot() {
  const root = mkTmpDir('sfvc-bl717-inv-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

const blankArb = fc.constantFrom('', '   ', '\n\t  ', '  ');
const nonBlankArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);
const replyTextArb = fc.oneof(blankArb, nonBlankArb);
const modeArb = fc.constantFrom('client', 'server');

async function runTurn(replyText, mode) {
  const target = mkRoot();
  const session = createMockCursorBridgeAgentSession(target);
  session.promptAgent = async () => ({ replyText, agentId: 'agent-1' });
  const deps = {
    agentSession: session,
    transcribeAudio: async () => ({ kind: 'ok', transcript: 'status' }),
  };
  if (mode === 'client') {
    deps.clientTts = true;
  } else {
    deps.synthesizeSpeech = async (text) => ({ kind: 'ok', audio: Buffer.from(`audio:${text}`) });
  }
  return processLetsTalkTurn({ audioBase64: Buffer.from('audio-chunk').toString('base64') }, deps);
}

test('property: a successful turn never carries a blank reply, and a real reply is never replaced by the fallback', async () => {
  await fc.assert(
    fc.asyncProperty(replyTextArb, modeArb, async (replyText, mode) => {
      const result = await runTurn(replyText, mode);
      assert.equal(result.success, true, 'this mock agent path never legitimately fails');
      assert.ok(result.replyText.trim().length > 0, 'a successful turn must never carry a blank replyText');
      if (replyText.trim().length > 0) {
        assert.equal(result.replyText, replyText, 'a real reply must never be replaced by the fallback line');
      } else {
        assert.equal(
          result.replyText,
          LETS_TALK_EMPTY_REPLY_FALLBACK_TEXT,
          'a blank agent reply must surface the explicit fallback line, not silence'
        );
      }
    }),
    { numRuns: 100 }
  );
});

test('property: client-TTS mode always carries non-blank replySpeechText alongside a successful turn', async () => {
  await fc.assert(
    fc.asyncProperty(replyTextArb, async (replyText) => {
      const result = await runTurn(replyText, 'client');
      assert.equal(result.success, true);
      assert.ok(
        typeof result.replySpeechText === 'string' && result.replySpeechText.trim().length > 0,
        'client-TTS mode must always hand the phone something non-blank to speak'
      );
    }),
    { numRuns: 60 }
  );
});

test('non-vacuity: without the fallback substitution, a blank reply violates the property', () => {
  // Mirrors the pre-fix behavior this ticket closed: replyText passed
  // through untouched, so a blank agent reply reached a `success: true`
  // turn with nothing to say.
  function brokenChooseReplyText(agentReplyText) {
    return agentReplyText;
  }
  for (const blank of ['', '   ', '\n\t  ']) {
    const replyText = brokenChooseReplyText(blank);
    assert.equal(
      replyText.trim().length > 0,
      false,
      'the broken chooser leaves replyText blank on a successful turn — the exact silent-success bug this property catches'
    );
  }
});
