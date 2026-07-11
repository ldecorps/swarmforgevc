'use strict';

// BL-300: step handlers for "The Concierge runtime derives task events
// from the live backlog and routes each into its BL-### topic, persisting
// the topic map". Drives the REAL compiled runConciergeTick
// (extension/out/concierge/conciergeTick.js) directly against fake
// in-memory adapters (no fs, no network) - mirroring conciergeTick.test.js's
// own fakeAdapters shape and swarmEventStreamSteps.js's own "require the
// compiled pure module" pattern.
const path = require('node:path');

const { runConciergeTick } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'conciergeTick'));

const BACKLOG_ID = 'BL-123';
const TITLE = 'a fine feature';

function buildAdapters(ctx) {
  return {
    readFolders: () => ctx.folders,
    readTickState: () => ctx.state,
    writeTickState: (next) => {
      ctx.state = next;
    },
    routeAdapters: {
      getTopicMap: () => ctx.topicMap,
      createTopic: async (name) => {
        ctx.created.push(name);
        return { success: true, topicId: 900 + ctx.created.length };
      },
      recordTopicId: (backlogId, topicId) => {
        ctx.topicMap[backlogId] = topicId;
      },
      sendMessage: async (topicId, text) => {
        ctx.sent.push({ topicId, text });
        return true;
      },
      closeTopic: async (topicId) => {
        ctx.closed.push(topicId);
        return true;
      },
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the Concierge runtime is ticking over the swarm's live backlog state$/, (ctx) => {
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.closed = [];
    ctx.state = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [], done: [] };
    ctx.adapters = buildAdapters(ctx);
  });

  // ── concierge-wiring-01 ──────────────────────────────────────────────
  registry.define(/^a backlog item that has newly (started being worked|completed)$/, async (ctx, lifecycle) => {
    if (lifecycle === 'started being worked') {
      ctx.folders.active = [{ id: BACKLOG_ID, title: TITLE }];
      return;
    }
    // "completed" needs an already-mapped topic (BL-299's own no-op-if-
    // unmapped rule) - run a REAL prior tick with the item active to
    // establish it, mirroring the ticket's own QA e2e procedure ("move
    // active -> creates a topic; move to done and re-tick").
    ctx.folders.active = [{ id: BACKLOG_ID, title: TITLE }];
    await runConciergeTick(ctx.adapters);
    ctx.folders.active = [];
    ctx.folders.done = [{ id: BACKLOG_ID, title: TITLE }];
  });

  registry.define(/^the runtime tick derives and routes events$/, async (ctx) => {
    ctx.result = await runConciergeTick(ctx.adapters);
  });

  registry.define(
    /^it creates the item's topic, posts its opening message, and persists the backlog-id-to-topic-id mapping for later reads$/,
    (ctx) => {
      if (ctx.created.length !== 1) {
        throw new Error(`expected exactly one createTopic call, got ${JSON.stringify(ctx.created)}`);
      }
      if (ctx.sent.length !== 1) {
        throw new Error(`expected exactly one posted message, got ${JSON.stringify(ctx.sent)}`);
      }
      if (typeof ctx.topicMap[BACKLOG_ID] !== 'number') {
        throw new Error(`expected the backlog-id-to-topic-id mapping to be persisted, got ${JSON.stringify(ctx.topicMap)}`);
      }
    }
  );

  registry.define(/^it posts a completion summary into the item's topic and closes it$/, (ctx) => {
    const lastSent = ctx.sent[ctx.sent.length - 1];
    if (!lastSent || lastSent.text.indexOf(BACKLOG_ID) === -1 || !/complete/i.test(lastSent.text)) {
      throw new Error(`expected a completion summary naming ${BACKLOG_ID}, got ${JSON.stringify(ctx.sent)}`);
    }
    if (ctx.closed.length !== 1) {
      throw new Error(`expected the topic to be closed exactly once, got ${JSON.stringify(ctx.closed)}`);
    }
  });

  // ── concierge-wiring-02 ──────────────────────────────────────────────
  registry.define(/^an event already routed before the runtime restarted$/, async (ctx) => {
    ctx.folders.active = [{ id: BACKLOG_ID, title: TITLE }];
    await runConciergeTick(ctx.adapters);
    ctx.createdBeforeRestart = ctx.created.length;
    // Simulate a restart: a FRESH adapters object, reading the SAME
    // persisted state (ctx.state/ctx.topicMap), as a real restart would
    // read the same files back off disk.
    ctx.adapters = buildAdapters(ctx);
  });

  registry.define(/^the tick runs once more following the restart$/, async (ctx) => {
    ctx.result = await runConciergeTick(ctx.adapters);
  });

  registry.define(/^that event is not routed a second time$/, (ctx) => {
    if (ctx.created.length !== ctx.createdBeforeRestart) {
      throw new Error(`expected no additional createTopic call after the restart, went from ${ctx.createdBeforeRestart} to ${ctx.created.length}`);
    }
    if (ctx.result.routed !== 0) {
      throw new Error(`expected 0 events routed on the post-restart tick, got ${ctx.result.routed}`);
    }
  });
}

module.exports = { registerSteps };
