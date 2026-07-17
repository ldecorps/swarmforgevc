'use strict';

// BL-468: step handlers for "The pipeline board posts the new message
// before deleting the old one, so there is always at least one board to
// look at". Drives the REAL compiled syncPipelineBoard
// (pipelineBoardSync.ts) against injected post/delete adapters that record
// every call in arrival order - never a hand-rolled substitute for the
// real post-then-delete/failed-post logic, mirroring
// pipelineBoardSync.test.js's own fixture shape.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { syncPipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoardSync'));

const TOPIC_ID = 900;
const T1 = Date.UTC(2026, 6, 16, 20, 5);
const T2 = Date.UTC(2026, 6, 16, 20, 6);

function board(rows) {
  return { rows, parked: [] };
}

function fakeAdapters(ctx, overrides = {}) {
  return {
    ensureBoardTopic: async () => ({ topicId: TOPIC_ID }),
    postMessage: async (topicId, text) => {
      ctx.calls.push({ fn: 'post', topicId, text });
      return { messageId: ctx.nextMessageId ?? 1 };
    },
    deleteMessage: async (topicId, messageId) => {
      ctx.calls.push({ fn: 'delete', topicId, messageId });
      return true;
    },
    ...overrides,
  };
}

function registerSteps(registry) {
  registry.define(/^a pipeline board sync driven by injected post and delete adapters$/, (ctx) => {
    ctx.calls = [];
    ctx.data = board([{ id: 'BL-1', column: 'coder', slug: '' }]);
    ctx.prevState = undefined;
  });

  registry.define(/^a previously posted board message exists$/, async (ctx) => {
    ctx.nextMessageId = 42;
    const first = await syncPipelineBoard(ctx.data, undefined, fakeAdapters(ctx), T1);
    ctx.prevState = first.state;
    ctx.calls = []; // only the SCENARIO's own sync call is under test below.
  });

  registry.define(/^no board message has been posted yet$/, (ctx) => {
    ctx.prevState = undefined;
  });

  registry.define(/^the board content has changed$/, (ctx) => {
    ctx.data = board([{ id: 'BL-1', column: 'QA', slug: '' }]);
  });

  registry.define(/^posting the new board message fails$/, (ctx) => {
    ctx.postFails = true;
  });

  registry.define(/^the board sync runs$/, async (ctx) => {
    ctx.nextMessageId = 99;
    const adapters = ctx.postFails
      ? fakeAdapters(ctx, {
          postMessage: async (topicId, text) => {
            ctx.calls.push({ fn: 'post', topicId, text });
            return {};
          },
        })
      : fakeAdapters(ctx);
    ctx.result = await syncPipelineBoard(ctx.data, ctx.prevState, adapters, T2);
  });

  registry.define(/^the new board message is posted before the old board message is deleted$/, (ctx) => {
    const fns = ctx.calls.map((c) => c.fn);
    if (fns.length !== 2 || fns[0] !== 'post' || fns[1] !== 'delete') {
      throw new Error(`expected exactly [post, delete] in that order, got: ${JSON.stringify(fns)}`);
    }
  });

  registry.define(/^the old board message is not deleted$/, (ctx) => {
    if (ctx.calls.some((c) => c.fn === 'delete')) {
      throw new Error(`expected no delete call at all, got: ${JSON.stringify(ctx.calls)}`);
    }
  });

  registry.define(/^the board sync outcome is failed-post$/, (ctx) => {
    if (ctx.result.outcome !== 'failed-post') {
      throw new Error(`expected outcome failed-post, got: ${ctx.result.outcome}`);
    }
    if (ctx.result.state.messageId !== ctx.prevState.messageId) {
      throw new Error(`expected the OLD (still-live) messageId to remain in state, got: ${JSON.stringify(ctx.result.state)}`);
    }
  });

  registry.define(/^the new board message is posted$/, (ctx) => {
    const postCalls = ctx.calls.filter((c) => c.fn === 'post');
    if (postCalls.length !== 1) {
      throw new Error(`expected exactly one post call, got: ${JSON.stringify(ctx.calls)}`);
    }
    if (ctx.result.outcome !== 'posted') {
      throw new Error(`expected outcome posted, got: ${ctx.result.outcome}`);
    }
  });

  registry.define(/^no delete is attempted$/, (ctx) => {
    if (ctx.calls.some((c) => c.fn === 'delete')) {
      throw new Error(`expected no delete call at all (nothing to delete), got: ${JSON.stringify(ctx.calls)}`);
    }
  });
}

module.exports = { registerSteps };
