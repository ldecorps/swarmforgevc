'use strict';

// BL-424: step handlers for "a paused ticket awaiting the human's approval
// gets a distinct topic icon". Scenario 01 drives the REAL compiled
// resolveIconState (extension/out/concierge/topicIcon) directly - a pure
// function, no adapters needed, mirroring bl417FeatureTopicIconMusicalNoteSteps.js's
// own Scenario Outline shape. Scenario 02 drives the REAL compiled
// runConciergeTick against fake in-memory adapters, the same fixture shape
// extension/test/conciergeTick.test.js and the other topic-icon step files
// already use for this exact module - never a hand-rolled substitute for
// the real sync/fallback logic.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { resolveIconState } = require(path.join(EXT_OUT, 'concierge', 'topicIcon'));
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough - so a mutated example value fails loudly instead of
// silently resolving to `undefined` and an assertion comparing
// undefined !== undefined passing for the wrong reason.
const KNOWN_TYPES = { feature: true, bug: true };
const KNOWN_FOLDERS = { paused: true, active: true, done: true };
const KNOWN_APPROVALS = { pending: true, approved: true };
const KNOWN_STATES = { 'awaiting-approval': true, paused: true, feature: true, defect: true, done: true };

const TICKET_ID = 'BL-424-fixture';

const ALL_STICKERS = [
  { emoji: '✅', customEmojiId: 'id-check' },
  { emoji: '🦠', customEmojiId: 'id-microbe' },
  { emoji: '🎵', customEmojiId: 'id-note' },
  { emoji: '🔍', customEmojiId: 'id-magnifier' },
  { emoji: '👀', customEmojiId: 'id-eyes' },
];

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

// Same fakeAdapters shape the other topic-icon step files/
// extension/test/conciergeTick.test.js already use for this module.
function fakeConciergeAdapters(stickers) {
  const state = { snapshot: null, emittedKeys: [] };
  const topicMap = {};
  const iconsSet = [];
  const iconOwnership = {};
  let currentFolders = folders();
  return {
    state,
    topicMap,
    iconsSet,
    setFolders: (f) => {
      currentFolders = f;
    },
    adapters: {
      readFolders: () => currentFolders,
      readGates: () => [],
      readRoleTicket: () => ({}),
      readTickState: () => state,
      writeTickState: (next) => {
        state.snapshot = next.snapshot;
        state.emittedKeys = next.emittedKeys;
        state.standingIconSeenIds = next.standingIconSeenIds;
      },
      routeAdapters: {
        getTopicMap: () => topicMap,
        createTopic: async () => ({ success: true, topicId: 800 + Object.keys(topicMap).length + 1 }),
        recordTopicId: (backlogId, topicId) => {
          topicMap[backlogId] = topicId;
        },
        sendMessage: async () => true,
        closeTopic: async () => true,
        recordMessage: () => {},
        ensureOperatorTopic: async () => 700,
        ensureApprovalsTopic: async () => 750,
        // BL-493: the standing Backlog topic + edit-in-place post/edit pair
        // + per-ticket message-identity store - this feature's own
        // scenarios don't assert on ticket-status routing, but
        // runConciergeTick unconditionally reaches these now.
        ensureBacklogTopic: async () => 760,
        postMessage: async () => 9000,
        editMessage: async () => true,
        getTicketMessageState: () => undefined,
        setTicketMessageState: () => {},
      },
      iconAdapters: {
        getIconStickers: async () => stickers,
        setTopicIcon: async (topicId, iconId) => {
          iconsSet.push({ topicId, iconId });
          return true;
        },
        readSwarmIconId: (id) => iconOwnership[id],
        recordSwarmIconId: (id, iconId) => {
          iconOwnership[id] = iconId;
        },
      },
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the topic icon is resolved from a ticket's folder, type, and approval state$/, () => {
    // Non-behavioral: the real resolveIconState/runConciergeTick are driven
    // directly by each scenario's own steps below.
  });

  // ── approval-icon-state-01 (Scenario Outline, pure) ────────────────────
  registry.define(/^a "([^"]*)" ticket in the "([^"]*)" folder with human_approval "([^"]*)"$/, (ctx, type, folder, approval) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_TYPES, type)) {
      throw new Error(`approval-icon-state-01: unrecognized <type> example value "${type}"`);
    }
    if (!Object.prototype.hasOwnProperty.call(KNOWN_FOLDERS, folder)) {
      throw new Error(`approval-icon-state-01: unrecognized <folder> example value "${folder}"`);
    }
    if (!Object.prototype.hasOwnProperty.call(KNOWN_APPROVALS, approval)) {
      throw new Error(`approval-icon-state-01: unrecognized <approval> example value "${approval}"`);
    }
    ctx.type = type;
    ctx.folder = folder;
    ctx.approval = approval;
  });

  registry.define(/^its icon state is resolved$/, (ctx) => {
    ctx.resolvedState = resolveIconState(ctx.folder, ctx.type, ctx.approval);
  });

  registry.define(/^the icon state is "([^"]*)"$/, (ctx, state) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_STATES, state)) {
      throw new Error(`approval-icon-state-01: unrecognized <state> example value "${state}"`);
    }
    if (ctx.resolvedState !== state) {
      throw new Error(`expected the icon state to be "${state}", got "${ctx.resolvedState}"`);
    }
  });

  // ── approval-icon-fallback-02 ────────────────────────────────────────
  registry.define(/^the awaiting-approval glyph is absent from Telegram's live forum-topic icon set$/, async (ctx) => {
    ctx.fixture = fakeConciergeAdapters(ALL_STICKERS.filter((s) => s.emoji !== '👀'));
    // BL-493: a ticket event no longer opens (or reuses) a per-ticket topic
    // at all - the icon-sync mechanism only ever still applies to a LEGACY
    // topic the swarm already owns (from before BL-493 shipped), so that
    // state is seeded directly rather than relying on a first tick's
    // TaskStarted to establish it, the same fix
    // extension/test/conciergeTick.test.js's own topic-icon tests apply.
    ctx.fixture.topicMap[TICKET_ID] = 600;
    ctx.fixture.adapters.iconAdapters.recordSwarmIconId(TICKET_ID, 'id-note');
    ctx.fixture.setFolders(folders({ active: [{ id: TICKET_ID, title: 'a fine feature', type: 'feature' }] }));
    await runConciergeTick(ctx.fixture.adapters);
    ctx.fixture.iconsSet.length = 0;
  });

  registry.define(/^the paused glyph is present in that set$/, () => {
    // Documentation-only: confirmed by the fixture's own sticker list
    // above, which omits ONLY the awaiting-approval glyph.
  });

  registry.define(/^the icon sticker for a paused pending-approval ticket is resolved$/, async (ctx) => {
    ctx.fixture.setFolders(folders({ paused: [{ id: TICKET_ID, title: 'a fine feature', type: 'feature', humanApproval: 'pending' }] }));
    await runConciergeTick(ctx.fixture.adapters);
  });

  registry.define(/^the plain paused icon sticker is used rather than failing$/, (ctx) => {
    const iconsSet = ctx.fixture.iconsSet;
    if (iconsSet.length !== 1 || iconsSet[0].iconId !== 'id-magnifier') {
      throw new Error(`expected the fallback to the plain paused icon sticker (id-magnifier), got: ${JSON.stringify(iconsSet)}`);
    }
  });
}

module.exports = { registerSteps };
