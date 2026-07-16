'use strict';

// BL-426 slice 1: step handlers for the coordinator's Operator-topic
// voice-note round trip (STT in, TTS out). Drives the REAL pure/
// adapter-injected core (pollAndForward/decideVoiceUpdateAction and
// relaySseReplies/deliverReply via telegramFrontDeskBotCore.ts) - fakes
// only the Telegram/network/provider boundary (getUpdates, postToBridge,
// transcribeVoice, synthesizeVoice, sendVoice), the same "drive the real
// core, fake only the Telegram/network boundary" posture as
// bl425RoleSteeringTopicsSteps.js.
const { pollAndForward, runPollCycle, relaySseReplies, OPERATOR_SUBJECT_ID } = require(
  '../../../extension/out/tools/telegramFrontDeskBotCore'
);

const PRINCIPAL_ID = 111;
const NON_PRINCIPAL_ID = 999;
const CHAT_ID = '1';
const OPERATOR_TOPIC_ID = 7;
const VOICE_FILE_ID = 'file-abc';
const TRANSCRIPT = 'what is the status of BL-400';
const REPLY_TEXT = 'BL-400 is in QA';

function mkVoiceUpdate(fromId) {
  return { update_id: 0, message: { message_id: 1, chat: { id: 1 }, from: { id: fromId }, message_thread_id: OPERATOR_TOPIC_ID, voice: { file_id: VOICE_FILE_ID, duration: 3 } } };
}

function mkTextUpdate(fromId, text) {
  return { update_id: 0, message: { message_id: 1, chat: { id: 1 }, from: { id: fromId }, message_thread_id: OPERATOR_TOPIC_ID, text } };
}

// The Operator topic is already bound to OPERATOR_SUBJECT_ID for every
// scenario here (the Background's own precondition) - a plain lookup is
// enough, no fixture file needed (telegramFrontDeskBotCore.ts's
// subjectForTopic is a pure function over whatever map the caller hands it).
function operatorSubjectForTopic(topicId) {
  return topicId === OPERATOR_TOPIC_ID ? OPERATOR_SUBJECT_ID : undefined;
}

function sttAdapterFor(ctx) {
  return async (fileId) => {
    ctx.sttCalls.push(fileId);
    if (ctx.sttMode === 'transient-failure') {
      return { kind: 'transient-failure' };
    }
    if (ctx.sttMode === 'unprocessable') {
      return { kind: 'unprocessable' };
    }
    return { kind: 'ok', transcript: TRANSCRIPT };
  };
}

function buildPollAdapters(ctx) {
  return {
    chatId: CHAT_ID,
    subjectForTopic: operatorSubjectForTopic,
    backlogForTopic: () => undefined,
    postToBridge: async (subjectId, text) => {
      ctx.posted.push({ subjectId, text });
      return true;
    },
    openSubjectAndRecord: async () => {
      throw new Error('openSubjectAndRecord should not be called - the Operator topic is already bound');
    },
    transcribeVoice: sttAdapterFor(ctx),
    markVoiceOriginatedTurn: async (subjectId) => {
      ctx.marked.push(subjectId);
    },
  };
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^the front-desk bot is polling the Telegram forum$/, (ctx) => {
    ctx.posted = [];
    ctx.marked = [];
    ctx.sttCalls = [];
    ctx.sttMode = 'ok';
    ctx.sentTexts = [];
    ctx.synthesized = [];
    ctx.voiceSent = [];
    ctx.voiceOriginatedSubjects = new Set();
  });

  registry.define(/^the coordinator's Operator topic exists$/, () => {
    // Modeled as a pure lookup (operatorSubjectForTopic above) rather than a
    // fixture file - every scenario here treats OPERATOR_TOPIC_ID as already
    // bound, matching the ticket's own Background precondition.
  });

  registry.define(/^an authorised principal$/, () => {
    // PRINCIPAL_ID above IS the authorised principal every scenario checks
    // against; nothing to set up beyond the constant itself.
  });

  // ── audio-voice-note-coordinator-01 ─────────────────────────────────────

  registry.define(/^the principal sends a voice note in the coordinator's Operator topic$/, (ctx) => {
    ctx.pendingUpdate = mkVoiceUpdate(PRINCIPAL_ID);
  });

  registry.define(/^the front-desk bot processes the update$/, async (ctx) => {
    ctx.deliverResult = await pollAndForward(0, String(PRINCIPAL_ID), {
      ...buildPollAdapters(ctx),
      getUpdates: async () => ({ success: true, updates: [ctx.pendingUpdate] }),
    });
  });

  registry.define(/^the voice audio is fetched and sent to speech-to-text$/, (ctx) => {
    if (!ctx.sttCalls.includes(VOICE_FILE_ID)) {
      throw new Error(`expected speech-to-text to be invoked with the voice note's file id; got ${JSON.stringify(ctx.sttCalls)}`);
    }
  });

  registry.define(/^the transcript is delivered to the coordinator on the Operator text path$/, (ctx) => {
    if (!ctx.posted.some((p) => p.subjectId === OPERATOR_SUBJECT_ID && p.text === TRANSCRIPT)) {
      throw new Error(`expected the transcript posted to the Operator subject; got ${JSON.stringify(ctx.posted)}`);
    }
  });

  registry.define(/^the update offset advances past the delivered voice note$/, (ctx) => {
    if (ctx.deliverResult.nextOffset !== 1) {
      throw new Error(`expected the offset to advance past update_id 0 (nextOffset 1); got ${ctx.deliverResult.nextOffset}`);
    }
  });

  // ── audio-voice-note-coordinator-02 (outbound TTS) ──────────────────────

  registry.define(/^the coordinator's turn was opened by a voice note$/, (ctx) => {
    ctx.voiceOriginatedSubjects.add(OPERATOR_SUBJECT_ID);
  });

  registry.define(/^the coordinator's text reply is relayed back to the Operator topic$/, async (ctx) => {
    await relaySseReplies(
      '',
      {
        readChunk: (() => {
          let sent = false;
          return async () => {
            if (sent) {
              return { done: true, chunk: '' };
            }
            sent = true;
            return { done: false, chunk: `event: telegram-reply\ndata: ${JSON.stringify({ id: 'r1', threadId: OPERATOR_SUBJECT_ID, text: REPLY_TEXT })}\n\n` };
          };
        })(),
        sendReply: async (topicId, text) => {
          ctx.sentTexts.push({ topicId, text });
        },
        resolveDelivery: () => ({ kind: 'topic', topicId: OPERATOR_TOPIC_ID, alsoPointerToDefault: false }),
        ackReply: async () => {},
        isVoiceOriginatedTurn: async (threadId) => ctx.voiceOriginatedSubjects.has(threadId),
        clearVoiceOriginatedTurn: async (threadId) => {
          ctx.voiceOriginatedSubjects.delete(threadId);
        },
        synthesizeVoice: async (text) => {
          ctx.synthesized.push(text);
          return { kind: 'ok', audio: Buffer.from('synth-audio') };
        },
        sendVoice: async (topicId, audio) => {
          ctx.voiceSent.push({ topicId, audio });
        },
      },
      new Set()
    );
  });

  registry.define(/^the reply text is synthesized to a voice note$/, (ctx) => {
    if (!ctx.synthesized.includes(REPLY_TEXT)) {
      throw new Error(`expected the reply text to be synthesized; got ${JSON.stringify(ctx.synthesized)}`);
    }
  });

  registry.define(/^the voice note is sent to the same Operator topic$/, (ctx) => {
    if (!ctx.voiceSent.some((v) => v.topicId === OPERATOR_TOPIC_ID)) {
      throw new Error(`expected a voice note sent to topic ${OPERATOR_TOPIC_ID}; got ${JSON.stringify(ctx.voiceSent)}`);
    }
    if (!ctx.sentTexts.some((s) => s.topicId === OPERATOR_TOPIC_ID && s.text === REPLY_TEXT)) {
      throw new Error('expected the text transcript to still be sent alongside the voice note (voice + transcript, never voice-only)');
    }
  });

  // ── audio-voice-note-coordinator-03 (text unaffected) ───────────────────

  registry.define(/^the principal sends a text message in the coordinator's Operator topic$/, (ctx) => {
    ctx.pendingUpdate = mkTextUpdate(PRINCIPAL_ID, 'what is the status');
  });

  registry.define(/^the message is delivered to the coordinator as text$/, (ctx) => {
    if (!ctx.posted.some((p) => p.subjectId === OPERATOR_SUBJECT_ID && p.text === 'what is the status')) {
      throw new Error(`expected the plain text message delivered unchanged; got ${JSON.stringify(ctx.posted)}`);
    }
  });

  registry.define(/^speech-to-text is not invoked$/, (ctx) => {
    if (ctx.sttCalls.length !== 0) {
      throw new Error(`expected speech-to-text never invoked; got ${JSON.stringify(ctx.sttCalls)}`);
    }
  });

  // ── audio-voice-note-coordinator-04 (non-principal ignored) ─────────────

  registry.define(/^a non-principal sends a voice note in the coordinator's Operator topic$/, (ctx) => {
    ctx.pendingUpdate = mkVoiceUpdate(NON_PRINCIPAL_ID);
  });

  registry.define(/^the voice note is ignored$/, (ctx) => {
    if (ctx.deliverResult.dropped !== 1 || ctx.posted.length !== 0) {
      throw new Error(`expected the voice note dropped with nothing posted; got dropped=${ctx.deliverResult.dropped}, posted=${JSON.stringify(ctx.posted)}`);
    }
  });

  // ── audio-voice-note-coordinator-05 (transient STT failure) ─────────────

  registry.define(/^speech-to-text fails transiently$/, (ctx) => {
    ctx.sttMode = 'transient-failure';
  });

  registry.define(/^the update offset does not advance past the voice note$/, (ctx) => {
    if (ctx.deliverResult.nextOffset !== 0) {
      throw new Error(`expected the offset to stay parked at the unadvanced voice note; got ${ctx.deliverResult.nextOffset}`);
    }
  });

  registry.define(/^the transcription is retried within a bounded budget$/, async (ctx) => {
    const config = { backoffBaseMs: 0, backoffMaxMs: 0, degradedThreshold: 99, stuckRetryLimit: 3 };
    let state = { offset: 0, consecutiveFailures: 0, stuckAttempts: 0 };
    let escalated = false;
    for (let i = 0; i < config.stuckRetryLimit; i++) {
      const cycle = await runPollCycle(state, String(PRINCIPAL_ID), { ...buildPollAdapters(ctx), getUpdates: async () => ({ success: true, updates: [ctx.pendingUpdate] }) }, config);
      state = cycle.state;
      if (state.offset !== 0) {
        throw new Error('expected the offset to stay parked at the voice note across every retry cycle');
      }
      if (cycle.escalateStuckDelivery) {
        escalated = true;
      }
    }
    if (!escalated) {
      throw new Error(`expected the sustained retry to escalate within ${config.stuckRetryLimit} cycles (a BOUNDED budget); it never did`);
    }
  });

  // ── audio-voice-note-coordinator-06 (unprocessable, deliberate drop) ────

  registry.define(/^the principal sends a voice note with no decodable audio$/, (ctx) => {
    ctx.pendingUpdate = mkVoiceUpdate(PRINCIPAL_ID);
    ctx.sttMode = 'unprocessable';
  });

  registry.define(/^the voice note is dropped$/, (ctx) => {
    if (ctx.deliverResult.dropped !== 1) {
      throw new Error(`expected the voice note dropped exactly once; got dropped=${ctx.deliverResult.dropped}`);
    }
  });

  registry.define(/^the update offset advances past it$/, (ctx) => {
    if (ctx.deliverResult.nextOffset !== 1) {
      throw new Error(`expected the offset to advance past update_id 0 (nextOffset 1); got ${ctx.deliverResult.nextOffset}`);
    }
  });
}

module.exports = { registerSteps };
