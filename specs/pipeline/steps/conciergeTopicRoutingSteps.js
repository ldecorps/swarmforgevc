'use strict';

// BL-297: step handlers for "Concierge routes each swarm event into its
// BL-###'s Telegram topic". Drives the REAL compiled routeEvent/
// decideTopicAction (extension/out/concierge/topicRouter.js) directly
// against fake createTopic/sendMessage/recordTopicId adapters and an
// in-memory topic map - no live Telegram, no network, mirroring
// swarmEventStreamSteps.js's own "require the compiled pure module,
// fixture inputs" pattern.
const path = require('node:path');

const { routeEvent } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'topicRouter'));

const BACKLOG_ID = 'BL-123';
const TITLE = 'a fine feature';

function mkEvent(overrides = {}) {
  return { type: 'TaskStarted', backlogId: BACKLOG_ID, payload: {}, ...overrides };
}

function buildAdapters(ctx) {
  return {
    getTopicMap: () => ctx.topicMap,
    createTopic: async (name) => {
      ctx.created.push(name);
      return { success: true, topicId: 700 + ctx.created.length };
    },
    recordTopicId: (backlogId, topicId) => {
      ctx.topicMap[backlogId] = topicId;
    },
    sendMessage: async (topicId, text) => {
      ctx.sent.push({ topicId, text });
      return true;
    },
    // BL-299: routeEvent's own completion path calls this for a
    // TaskCompleted event - defined here (even though this feature's own
    // scenarios don't assert on it) so "a later event" fixtures that
    // happen to use TaskCompleted don't crash on a missing adapter.
    closeTopic: async (topicId) => {
      ctx.closed.push(topicId);
      return true;
    },
    // BL-329: routeEvent calls this unconditionally after a successful
    // send - defined here for the same reason closeTopic is above (this
    // feature's own scenarios don't assert on it, but routeEvent would
    // otherwise crash on a missing adapter).
    recordMessage: () => {},
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Concierge is routing a typed swarm event for a backlog item$/, (ctx) => {
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.closed = [];
    ctx.event = mkEvent();
  });

  // ── topic-routing-01 ─────────────────────────────────────────────────
  registry.define(/^the item has no topic yet$/, (ctx) => {
    ctx.topicMap = {};
  });

  registry.define(/^the Concierge routes the event$/, async (ctx) => {
    ctx.result = await routeEvent(ctx.event, TITLE, buildAdapters(ctx));
  });

  registry.define(/^it creates a topic named for the item and records the backlog-to-topic mapping$/, (ctx) => {
    if (ctx.created.length !== 1 || ctx.created[0] !== `${BACKLOG_ID} - ${TITLE}`) {
      throw new Error(`expected exactly one createTopic call named "${BACKLOG_ID} - ${TITLE}", got ${JSON.stringify(ctx.created)}`);
    }
    if (typeof ctx.topicMap[BACKLOG_ID] !== 'number') {
      throw new Error(`expected the backlog-to-topic mapping to be recorded, got ${JSON.stringify(ctx.topicMap)}`);
    }
  });

  registry.define(/^a later event for the same item posts into that topic, creating no second one$/, async (ctx) => {
    const mappedTopicId = ctx.topicMap[BACKLOG_ID];
    await routeEvent(mkEvent({ type: 'TaskCompleted' }), TITLE, buildAdapters(ctx));
    if (ctx.created.length !== 1) {
      throw new Error(`expected no second createTopic call, got ${ctx.created.length} total`);
    }
    const lastSent = ctx.sent[ctx.sent.length - 1];
    if (lastSent.topicId !== mappedTopicId) {
      throw new Error(`expected the later event to post into the SAME topic ${mappedTopicId}, got ${lastSent.topicId}`);
    }
  });

  // ── topic-routing-02 ─────────────────────────────────────────────────
  registry.define(/^the message goes into the item's topic and never the main group chat$/, (ctx) => {
    if (ctx.sent.length !== 1) {
      throw new Error(`expected exactly one sent message, got ${ctx.sent.length}`);
    }
    if (typeof ctx.sent[0].topicId !== 'number') {
      throw new Error(`expected the sent message to carry a concrete topic id, got ${JSON.stringify(ctx.sent[0])}`);
    }
  });

  // ── topic-routing-03 ─────────────────────────────────────────────────
  registry.define(/^the posted message names the event's type$/, (ctx) => {
    if (!ctx.sent[0] || ctx.sent[0].text.indexOf(ctx.event.type) === -1) {
      throw new Error(`expected the posted message to name "${ctx.event.type}", got ${JSON.stringify(ctx.sent)}`);
    }
  });
}

module.exports = { registerSteps };
