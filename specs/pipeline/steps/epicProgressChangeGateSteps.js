'use strict';

// BL-394: step handlers for "epic-progress Telegram announcements fire only
// on a real progress change". Drives the REAL compiled runConciergeTick
// (conciergeTick.ts) against fake in-memory adapters, mirroring
// epicsAsFirstClassTopicsSteps.js's own buildAdapters shape - no live
// Telegram/network.
//
// Every "already announced" Given forces the SAME re-derivation mechanism
// the live incident hit: one ticket's own per-ticket post is rigged to
// keep failing (ctx.stuckText), so withRetryableTransitionsHeldBack
// (conciergeTick.ts) holds its transition back out of the persisted
// snapshot and the SAME TaskStarted/TaskCompleted event re-derives on
// every following tick, with the epic's own aggregate never changing.
// That is the only way the epic's triggering event re-fires with nothing
// actually changed - a fixture with no retry at all would pass this
// scenario even on the pre-fix code, since the outer per-event dedup
// already prevents re-derivation when nothing is retrying.
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { runConciergeTick } = require(path.join(EXT_DIR, 'out', 'concierge', 'conciergeTick'));

const EPIC_ID = 'dynamic-routing';
const EPIC_TITLE = 'Dynamic Routing';
const SLICE_ID = 'BL-1';
const SLICE_TITLE = 'a fine feature';
const STUCK_COMPLETION_TEXT = `${SLICE_ID} - ${SLICE_TITLE} is complete.`;
const STUCK_OPENING_TEXT = `What it is: ${SLICE_TITLE}`;
const EPIC_OPENING_TEXT = `Epic: ${EPIC_TITLE}`;

function epicDefTicket() {
  return { id: `${EPIC_ID}-epic-ticket`, title: EPIC_TITLE, type: 'epic', epic: EPIC_ID, remainingSlices: [] };
}

function buildAdapters(ctx) {
  return {
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
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
        return ctx.stuckText === undefined || text !== ctx.stuckText;
      },
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
    },
    iconAdapters: {
      getIconStickers: async () => [],
      setTopicIcon: async () => true,
      readSwarmIconId: () => undefined,
      recordSwarmIconId: () => {},
    },
  };
}

function epicMessageCount(ctx) {
  return ctx.sent.filter((m) => m.topicId === ctx.epicTopicId).length;
}

function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────────
  registry.define(/^the concierge tick announces an epic's slice progress to its Telegram topic$/, (ctx) => {
    ctx.topicMap = {};
    ctx.created = [];
    ctx.sent = [];
    ctx.state = { snapshot: null, emittedKeys: [] };
    ctx.folders = { active: [], paused: [epicDefTicket()], done: [] };
    ctx.stuckText = undefined;
  });

  // ── epic-gate-01 ──────────────────────────────────────────────────────
  registry.define(/^an epic whose slice progress was already announced$/, async (ctx) => {
    ctx.folders.active.push({ id: SLICE_ID, title: SLICE_TITLE, epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
    // BL-1's own per-ticket completion post now gets stuck retrying.
    ctx.stuckText = STUCK_COMPLETION_TEXT;
    ctx.folders.active = [];
    ctx.folders.done.push({ id: SLICE_ID, title: SLICE_TITLE, epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
    ctx.epicTopicId = ctx.topicMap[EPIC_ID];
    ctx.epicMessagesSoFar = epicMessageCount(ctx);
  });

  registry.define(/^the concierge tick runs again with that epic's progress unchanged$/, async (ctx) => {
    await runConciergeTick(buildAdapters(ctx));
  });

  registry.define(/^it sends no epic message$/, (ctx) => {
    const now = epicMessageCount(ctx);
    if (now !== ctx.epicMessagesSoFar) {
      throw new Error(`expected no new epic message, went from ${ctx.epicMessagesSoFar} to ${now}: ${JSON.stringify(ctx.sent)}`);
    }
  });

  // ── epic-gate-02 ──────────────────────────────────────────────────────
  registry.define(/^an epic whose slice progress has advanced since it was last announced$/, async (ctx) => {
    ctx.folders.active.push(
      { id: 'BL-1', title: 'first slice', epic: EPIC_ID },
      { id: 'BL-2', title: 'second slice', epic: EPIC_ID }
    );
    await runConciergeTick(buildAdapters(ctx));
    ctx.epicTopicId = ctx.topicMap[EPIC_ID];
    ctx.folders.active = ctx.folders.active.filter((item) => item.id !== 'BL-1');
    ctx.folders.done.push({ id: 'BL-1', title: 'first slice', epic: EPIC_ID });
  });

  registry.define(/^the concierge tick runs$/, async (ctx) => {
    await runConciergeTick(buildAdapters(ctx));
  });

  registry.define(/^it sends exactly one epic-progress message carrying the new progress$/, (ctx) => {
    const progressMessages = ctx.sent.filter((m) => m.topicId === ctx.epicTopicId && m.text.includes('ticketed slice'));
    if (progressMessages.length !== 1 || progressMessages[0].text !== '1 of 2 ticketed slice(s) complete.') {
      throw new Error(`expected exactly one new-progress message, got ${JSON.stringify(progressMessages)}`);
    }
  });

  registry.define(/^it records that new progress as announced$/, (ctx) => {
    if (!ctx.state.emittedKeys.some((k) => k.includes('1 of 2 ticketed slice(s) complete.'))) {
      throw new Error(`expected the new progress durably recorded as announced, got ${JSON.stringify(ctx.state.emittedKeys)}`);
    }
  });

  // ── epic-gate-03 ──────────────────────────────────────────────────────
  registry.define(/^an epic whose progress was already announced and durably recorded$/, async (ctx) => {
    ctx.stuckText = STUCK_COMPLETION_TEXT;
    ctx.folders.active.push({ id: SLICE_ID, title: SLICE_TITLE, epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
    ctx.folders.active = [];
    ctx.folders.done.push({ id: SLICE_ID, title: SLICE_TITLE, epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
  });

  registry.define(/^the front desk restarts and the concierge tick runs with that epic's progress unchanged$/, async (ctx) => {
    // A restart rehydrates from ONLY what was durably persisted - a fresh
    // topicMap/sent/created plus the persisted snapshot+emittedKeys, never
    // the in-memory objects the prior "process" happened to still hold.
    const persistedSnapshot = ctx.state.snapshot;
    const persistedKeys = [...ctx.state.emittedKeys];
    const persistedTopicMap = { ...ctx.topicMap };
    ctx.topicMap = persistedTopicMap;
    ctx.created = [];
    ctx.sent = [];
    ctx.state = { snapshot: persistedSnapshot, emittedKeys: persistedKeys };
    ctx.stuckText = STUCK_COMPLETION_TEXT;
    ctx.epicTopicId = ctx.topicMap[EPIC_ID];
    ctx.epicMessagesSoFar = epicMessageCount(ctx);
    await runConciergeTick(buildAdapters(ctx));
  });

  // ── epic-gate-04 ──────────────────────────────────────────────────────
  registry.define(/^an epic whose opening line was already announced$/, async (ctx) => {
    // BL-1's own per-ticket opening post now gets stuck retrying.
    ctx.stuckText = STUCK_OPENING_TEXT;
    ctx.folders.active.push({ id: SLICE_ID, title: SLICE_TITLE, epic: EPIC_ID });
    await runConciergeTick(buildAdapters(ctx));
    ctx.epicTopicId = ctx.topicMap[EPIC_ID];
    if (!ctx.sent.some((m) => m.topicId === ctx.epicTopicId && m.text === EPIC_OPENING_TEXT)) {
      throw new Error(`expected the epic opening line already announced, got ${JSON.stringify(ctx.sent)}`);
    }
    ctx.epicMessagesSoFar = epicMessageCount(ctx);
  });
}

module.exports = { registerSteps };
