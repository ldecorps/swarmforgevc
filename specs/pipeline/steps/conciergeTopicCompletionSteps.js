'use strict';

// BL-299: step handlers for "Concierge posts a completion summary and
// closes a backlog item's topic when its task completes". Reuses
// conciergeTopicRoutingSteps.js's own Background ("the Concierge is
// routing a typed swarm event for a backlog item", already registered -
// initializes ctx.topicMap/created/sent/closed) and its own "the Concierge
// routes the event" When step (already calls the real compiled routeEvent
// and stores ctx.result) - this file only adds the Given/Then steps unique
// to BL-299's own Scenario Outline.
const BACKLOG_ID = 'BL-123';
const TITLE = 'a fine feature';
const TOPIC_ID = 42;

function registerSteps(registry) {
  registry.define(/^a (completion|progress) event for an item that (has a topic|has no topic)$/, (ctx, kind, topicState) => {
    ctx.event = { type: kind === 'completion' ? 'TaskCompleted' : 'TaskStarted', backlogId: BACKLOG_ID, payload: {} };
    if (topicState === 'has a topic') {
      ctx.topicMap[BACKLOG_ID] = TOPIC_ID;
    }
  });

  registry.define(/^it posts a completion summary naming the item, then closes the topic$/, (ctx) => {
    if (ctx.sent.length !== 1 || ctx.sent[0].topicId !== TOPIC_ID) {
      throw new Error(`expected exactly one message posted into topic ${TOPIC_ID}, got ${JSON.stringify(ctx.sent)}`);
    }
    if (ctx.sent[0].text.indexOf(BACKLOG_ID) === -1 || ctx.sent[0].text.indexOf(TITLE) === -1) {
      throw new Error(`expected the summary to name the item (${BACKLOG_ID} / "${TITLE}"), got: ${ctx.sent[0].text}`);
    }
    if (ctx.closed.length !== 1 || ctx.closed[0] !== TOPIC_ID) {
      throw new Error(`expected topic ${TOPIC_ID} to be closed exactly once, got ${JSON.stringify(ctx.closed)}`);
    }
  });

  registry.define(/^it posts the event and leaves the topic open$/, (ctx) => {
    if (ctx.sent.length !== 1 || ctx.sent[0].topicId !== TOPIC_ID) {
      throw new Error(`expected exactly one message posted into topic ${TOPIC_ID}, got ${JSON.stringify(ctx.sent)}`);
    }
    if (ctx.closed.length !== 0) {
      throw new Error(`expected the topic to stay open (no close call), got ${JSON.stringify(ctx.closed)}`);
    }
  });

  registry.define(/^it posts nothing and closes no topic$/, (ctx) => {
    if (ctx.sent.length !== 0 || ctx.closed.length !== 0 || ctx.created.length !== 0) {
      throw new Error(
        `expected a no-op (no post, no close, no topic created), got sent=${JSON.stringify(ctx.sent)} closed=${JSON.stringify(ctx.closed)} created=${JSON.stringify(ctx.created)}`
      );
    }
  });
}

module.exports = { registerSteps };
