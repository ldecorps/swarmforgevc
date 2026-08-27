'use strict';

// BL-497: step handlers for "the pipeline board surfaces and recovers from
// a failed post instead of freezing silently". Drives the REAL compiled
// syncPipelineBoard (pipelineBoardSync.ts) against injected adapters that
// record every call, never a hand-rolled substitute for the real
// classify/self-heal/bounded-retry/alert logic - mirroring
// pipelineBoardSync.test.js's own fixture shape.
//
// "the board sync runs" collides byte-for-byte with an existing unscoped
// registration in bl468PipelineBoardPostBeforeDeleteSteps.js (a DIFFERENT
// ctx shape entirely - see the stepRegistry.js BL-425 comment on why an
// unscoped first-registered handler would otherwise silently win here), so
// that one step is registered via defineScoped against this feature's own
// name - every other step below is unique text and stays a plain define.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { syncPipelineBoard, PIPELINE_BOARD_ALERT_FAILURE_CAP } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoardSync'));
const { renderPipelineBoardBody } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

const FEATURE_NAME = 'the pipeline board surfaces and recovers from a failed post instead of freezing silently';

const TOPIC_ID = 1634;
const T0 = Date.UTC(2026, 6, 17, 0, 0);

function boardWithSlug(slug) {
  return { rows: [{ id: 'BL-1', column: 'coder', slug }], parked: [] };
}

function nextTick(ctx) {
  ctx.tick = (ctx.tick ?? 0) + 1;
  return T0 + ctx.tick * 1000;
}

function bumpContent(ctx) {
  ctx.data = boardWithSlug(`tick-${ctx.tick}`);
}

// Shared by every "the board sync runs..." variant below - builds adapters
// off whatever ctx.failingStep/ctx.error/ctx.alertDelivers the scenario's
// own Given steps set up, records every call so Then steps can assert on
// them, and always advances the clock/content so the change-gate never
// short-circuits the attempt.
async function runOnce(ctx) {
  const nowMs = nextTick(ctx);
  bumpContent(ctx);
  const adapters = {
    ensureBoardTopic: async () => {
      ctx.ensured.push(true);
      if (ctx.failingStep === 'topic creation') {
        return { error: ctx.error };
      }
      return { topicId: ctx.freshTopicId ?? TOPIC_ID };
    },
    postMessage: async (topicId, text) => {
      ctx.posted.push({ topicId, text });
      if (ctx.failingStep === 'post to the topic') {
        return { error: ctx.error };
      }
      return { messageId: 42 };
    },
    deleteMessage: async () => true,
    emitFailureAlert: async (message) => {
      ctx.alertsSent.push(message);
      return ctx.alertDelivers !== false;
    },
  };
  ctx.result = await syncPipelineBoard(ctx.data, ctx.prevState, adapters, nowMs);
  ctx.prevState = ctx.result.state;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the board content has changed since the last post so a post is attempted$/, (ctx) => {
    ctx.tick = 0;
    ctx.ensured = [];
    ctx.posted = [];
    ctx.alertsSent = [];
    ctx.data = boardWithSlug('changed');
  });

  registry.define(/^the board's tracked topic id is "(\d+)" with a prior posted message$/, (ctx, topicIdText) => {
    ctx.prevState = {
      topicId: Number(topicIdText),
      messageId: 111,
      contentSignature: renderPipelineBoardBody(boardWithSlug('previous')),
      lastChangeMs: T0,
      consecutiveFailures: 0,
      alertArmed: false,
    };
  });

  // ── Scenario 01/02: failing step + surfaced error / classification ──────
  registry.define(/^the board (post to the topic|topic creation) fails with error "([^"]+)"$/, (ctx, failingStep, error) => {
    ctx.failingStep = failingStep;
    ctx.error = error;
    if (failingStep === 'topic creation') {
      // ensureBoardTopic is only ever attempted when no topic id is
      // currently tracked - this Given's own precondition.
      ctx.prevState = { ...ctx.prevState, topicId: undefined };
    }
  });

  registry.defineScoped(/^the board sync runs$/, runOnce, FEATURE_NAME);

  registry.define(/^the sync reports the failure with the error "([^"]+)"$/, (ctx, error) => {
    if (ctx.result.error !== error) {
      throw new Error(`expected the surfaced error "${error}", got: ${JSON.stringify(ctx.result.error)}`);
    }
  });

  registry.define(/^the failure is not silently swallowed$/, (ctx) => {
    if (ctx.result.outcome !== 'failed-post' && ctx.result.outcome !== 'failed-no-topic') {
      throw new Error(`expected a failed outcome, got: ${ctx.result.outcome}`);
    }
    if (!ctx.result.error) {
      throw new Error('expected a non-empty error carried on the result');
    }
  });

  registry.define(/^the failure is classified as "([^"]+)"$/, (ctx, expectedClass) => {
    if (ctx.result.failureClass !== expectedClass) {
      throw new Error(`expected failureClass "${expectedClass}", got: ${ctx.result.failureClass}`);
    }
  });

  registry.define(/^the tracked topic id is "(cleared|retained)"$/, (ctx, action) => {
    if (action === 'cleared' && ctx.result.state.topicId !== undefined) {
      throw new Error(`expected the tracked topic id cleared, got: ${ctx.result.state.topicId}`);
    }
    if (action === 'retained' && ctx.result.state.topicId === undefined) {
      throw new Error('expected the tracked topic id retained, got undefined');
    }
  });

  // ── Scenario 03: topic-gone self-heal on the next tick ──────────────────
  registry.define(/^the board post to the topic failed with error "([^"]+)"$/, (ctx, error) => {
    ctx.prevState = {
      ...ctx.prevState,
      topicId: undefined,
      messageId: undefined,
      consecutiveFailures: (ctx.prevState?.consecutiveFailures ?? 0) + 1,
      alertArmed: false,
    };
    ctx.lastError = error;
  });

  registry.define(/^the board sync cleared the tracked topic id on that tick$/, (ctx) => {
    if (ctx.prevState.topicId !== undefined) {
      throw new Error('expected the tracked topic id already cleared by the prior failed post');
    }
  });

  registry.define(/^the board sync runs again with a topic that now accepts the post$/, async (ctx) => {
    ctx.freshTopicId = 2000;
    ctx.failingStep = undefined;
    await runOnce(ctx);
  });

  registry.define(/^a fresh board topic is ensured$/, (ctx) => {
    if (ctx.ensured.length !== 1) {
      throw new Error(`expected ensureBoardTopic called exactly once, got ${ctx.ensured.length} calls`);
    }
  });

  registry.define(/^the board is posted into the fresh topic$/, (ctx) => {
    const last = ctx.posted[ctx.posted.length - 1];
    if (!last || last.topicId !== ctx.freshTopicId) {
      throw new Error(`expected the board posted into topic ${ctx.freshTopicId}, got: ${JSON.stringify(last)}`);
    }
  });

  registry.define(/^the board is visible again without human intervention$/, (ctx) => {
    if (ctx.result.outcome !== 'posted' && ctx.result.outcome !== 'reposted') {
      throw new Error(`expected a successful post outcome, got: ${ctx.result.outcome}`);
    }
    if (ctx.result.state.messageId === undefined) {
      throw new Error('expected a messageId recorded after recovery');
    }
  });

  // ── Scenario 04: bounded retry + exactly one alert ──────────────────────
  registry.define(/^the board post to the topic has failed transiently on each of the last cap-minus-one ticks$/, (ctx) => {
    ctx.prevState = {
      ...ctx.prevState,
      topicId: TOPIC_ID,
      consecutiveFailures: PIPELINE_BOARD_ALERT_FAILURE_CAP - 1,
      alertArmed: false,
    };
  });

  registry.define(/^the board sync runs and the post fails transiently again$/, async (ctx) => {
    ctx.failingStep = 'post to the topic';
    ctx.error = 'Too Many Requests: retry after 26';
    await runOnce(ctx);
  });

  registry.define(/^exactly one operator alert naming the frozen board is emitted$/, (ctx) => {
    if (ctx.alertsSent.length !== 1) {
      throw new Error(`expected exactly one alert emitted, got: ${JSON.stringify(ctx.alertsSent)}`);
    }
    if (!/pipeline board/i.test(ctx.alertsSent[0])) {
      throw new Error(`expected the alert to name the board, got: ${ctx.alertsSent[0]}`);
    }
  });

  registry.define(/^the same topic id "(\d+)" is retained without creating a new topic$/, (ctx, topicIdText) => {
    if (ctx.result.state.topicId !== Number(topicIdText)) {
      throw new Error(`expected topic id ${topicIdText} retained, got: ${ctx.result.state.topicId}`);
    }
  });

  registry.define(/^a further transient failure on the next tick emits no additional alert$/, async (ctx) => {
    const alertsBefore = ctx.alertsSent.length;
    await runOnce(ctx);
    if (ctx.alertsSent.length !== alertsBefore) {
      throw new Error(`expected no additional alert, got: ${JSON.stringify(ctx.alertsSent)}`);
    }
  });

  // ── Scenario 05: success clears the failure episode ─────────────────────
  registry.define(/^the board has been in a failed-post state with its operator alert already armed$/, (ctx) => {
    ctx.prevState = {
      ...ctx.prevState,
      topicId: TOPIC_ID,
      consecutiveFailures: PIPELINE_BOARD_ALERT_FAILURE_CAP,
      alertArmed: true,
    };
  });

  registry.define(/^a subsequent board sync posts the board successfully$/, async (ctx) => {
    ctx.failingStep = undefined;
    await runOnce(ctx);
  });

  registry.define(/^the recorded consecutive-failure count is reset to zero$/, (ctx) => {
    if (ctx.result.state.consecutiveFailures !== 0) {
      throw new Error(`expected consecutiveFailures reset to 0, got: ${ctx.result.state.consecutiveFailures}`);
    }
  });

  registry.define(/^the armed operator alert is cleared$/, (ctx) => {
    if (ctx.result.state.alertArmed !== false) {
      throw new Error(`expected alertArmed cleared to false, got: ${ctx.result.state.alertArmed}`);
    }
  });

  registry.define(/^a later transient failure episode is able to alarm again$/, async (ctx) => {
    ctx.alertsSent = [];
    ctx.failingStep = 'post to the topic';
    ctx.error = 'Too Many Requests: retry after 26';
    for (let i = 0; i < PIPELINE_BOARD_ALERT_FAILURE_CAP; i += 1) {
      await runOnce(ctx);
    }
    if (ctx.alertsSent.length !== 1) {
      throw new Error(`expected the later episode to alarm exactly once, got: ${JSON.stringify(ctx.alertsSent)}`);
    }
  });

  // ── Scenario 06: arm only on confirmed delivery ─────────────────────────
  registry.define(/^the board post has failed transiently past the retry cap$/, (ctx) => {
    ctx.prevState = {
      ...ctx.prevState,
      topicId: TOPIC_ID,
      consecutiveFailures: PIPELINE_BOARD_ALERT_FAILURE_CAP,
      alertArmed: false,
    };
    ctx.failingStep = 'post to the topic';
    ctx.error = 'Too Many Requests: retry after 26';
  });

  registry.define(/^emitting the operator alert itself fails$/, (ctx) => {
    ctx.alertDelivers = false;
  });

  registry.define(/^the operator alert is not recorded as delivered$/, (ctx) => {
    if (ctx.result.state.alertArmed !== false) {
      throw new Error(`expected alertArmed false (not delivered), got: ${ctx.result.state.alertArmed}`);
    }
  });

  registry.define(/^the next failing tick attempts the operator alert again rather than suppressing it$/, async (ctx) => {
    const attemptsBefore = ctx.alertsSent.length;
    ctx.alertDelivers = true;
    await runOnce(ctx);
    if (ctx.alertsSent.length !== attemptsBefore + 1) {
      throw new Error(`expected another alert attempt, got ${ctx.alertsSent.length} total attempts (before: ${attemptsBefore})`);
    }
    if (ctx.result.state.alertArmed !== true) {
      throw new Error(`expected the alert armed once delivery finally confirmed, got: ${ctx.result.state.alertArmed}`);
    }
  });
}

module.exports = { registerSteps };
