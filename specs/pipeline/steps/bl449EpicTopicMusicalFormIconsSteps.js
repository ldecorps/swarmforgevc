'use strict';

// BL-449: step handlers for the epic-topic musical-form icon assignment.
// Scenario 01 drives the REAL compiled resolveEpicIcon (extension/out/
// concierge/epicIcon) directly - a pure function, no adapters needed.
// Scenario 02 drives the REAL compiled runConciergeTick against fake
// in-memory adapters, the same fixture shape extension/test/
// conciergeTick.test.js and the other topic-icon step files already use for
// this exact module. Scenario 03 asserts the REAL EPIC_ICON_POOL/ICON_EMOJI/
// STANDING_TOPIC_ICON constants stay disjoint. Scenario 04 drives
// runConciergeTick with an empty live sticker set. Scenario 05 drives the
// REAL compiled syncTopicIcon directly - epics reuse that exact ownership
// rule, never a second implementation of it.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { resolveEpicIcon, EPIC_ICON_POOL } = require(path.join(EXT_OUT, 'concierge', 'epicIcon'));
const { ICON_EMOJI, STANDING_TOPIC_ICON } = require(path.join(EXT_OUT, 'concierge', 'topicIcon'));
const { syncTopicIcon } = require(path.join(EXT_OUT, 'concierge', 'topicIconSync'));
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_EPICS = {
  BENCHMARKING: 'role-benchmarking',
  DYNAMIC_ROUTING: 'dynamic-routing',
  ONBOARDING: 'onboarding-target-repo',
};
const KNOWN_EMOJI = { '🎙': true, '🎭': true, '🎬': true };
const KNOWN_OWNERSHIP = { 'not-owned': true, owned: true };
const KNOWN_PASSES = { 'live-tick': true, backfill: true };
const KNOWN_RESULTS = { unchanged: true, set: true };

const EPIC_STICKERS = [
  { emoji: '🎙', customEmojiId: 'id-mic' },
  { emoji: '🎭', customEmojiId: 'id-masks' },
  { emoji: '🎬', customEmojiId: 'id-clapper' },
  { emoji: '🎤', customEmojiId: 'id-mic2' },
];

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

function epicDefTicket(id, title) {
  return { id: `${id}-epic-ticket`, title, type: 'epic', epic: id, remainingSlices: [] };
}

// Same fakeAdapters shape topicIcon step files/extension/test/
// conciergeTick.test.js already use for this module.
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
        state.titleAgeBuckets = next.titleAgeBuckets;
      },
      routeAdapters: {
        getTopicMap: () => topicMap,
        createTopic: async (name) => ({ success: true, topicId: 800 + Object.keys(topicMap).length + 1 }),
        recordTopicId: (backlogId, topicId) => {
          topicMap[backlogId] = topicId;
        },
        sendMessage: async () => true,
        closeTopic: async () => true,
        recordMessage: () => {},
        ensureOperatorTopic: async () => 700,
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
  registry.define(/^epic icons are a separate concern from the ticket-state icons in topicIcon\.ts$/, () => {
    // Non-behavioral: the real resolveEpicIcon/runConciergeTick/syncTopicIcon
    // are driven directly by each scenario's own steps below.
  });

  // ── epic-icon-assignment-01 (Scenario Outline, pure) ───────────────────
  registry.define(/^the epic "([^"]*)"$/, (ctx, epic) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_EPICS, epic)) {
      throw new Error(`epic-icon-assignment-01: unrecognized <epic> example value "${epic}"`);
    }
    ctx.epicId = KNOWN_EPICS[epic];
  });

  registry.define(/^its epic icon is resolved$/, (ctx) => {
    ctx.resolvedIcon = resolveEpicIcon(ctx.epicId);
  });

  registry.define(/^the epic icon is "([^"]*)"$/, (ctx, emoji) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_EMOJI, emoji)) {
      throw new Error(`epic-icon-assignment-01: unrecognized <emoji> example value "${emoji}"`);
    }
    if (ctx.resolvedIcon !== emoji) {
      throw new Error(`expected the epic icon to be ${emoji}, got ${ctx.resolvedIcon}`);
    }
  });

  // ── epic-icon-new-topic-02 ──────────────────────────────────────────────
  registry.define(/^the seeded epics already hold their musical-form icons$/, async (ctx) => {
    ctx.fixture = fakeConciergeAdapters(EPIC_STICKERS);
    ctx.fixture.setFolders(folders({
      paused: [
        epicDefTicket('role-benchmarking', 'Swarm Role Benchmarking'),
        epicDefTicket('dynamic-routing', 'Dynamic Routing'),
        epicDefTicket('onboarding-target-repo', 'Onboarding a New Target Repo'),
      ],
      active: [
        { id: 'BL-901', title: 'benchmarking slice', epic: 'role-benchmarking' },
        { id: 'BL-902', title: 'routing slice', epic: 'dynamic-routing' },
        { id: 'BL-903', title: 'onboarding slice', epic: 'onboarding-target-repo' },
      ],
    }));
    await runConciergeTick(ctx.fixture.adapters);
    ctx.alreadyAssignedIconIds = ctx.fixture.iconsSet.map((s) => s.iconId);
    if (ctx.alreadyAssignedIconIds.length !== 3) {
      throw new Error(`expected the three seeded epics to each get an icon, got: ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });

  registry.define(/^a new epic topic beyond the seeded set is created$/, async (ctx) => {
    ctx.fixture.setFolders(folders({
      paused: [
        epicDefTicket('role-benchmarking', 'Swarm Role Benchmarking'),
        epicDefTicket('dynamic-routing', 'Dynamic Routing'),
        epicDefTicket('onboarding-target-repo', 'Onboarding a New Target Repo'),
      ],
      active: [
        { id: 'BL-901', title: 'benchmarking slice', epic: 'role-benchmarking' },
        { id: 'BL-902', title: 'routing slice', epic: 'dynamic-routing' },
        { id: 'BL-903', title: 'onboarding slice', epic: 'onboarding-target-repo' },
        { id: 'BL-904', title: 'a genuinely new epic slice', epic: 'a-brand-new-epic' },
      ],
    }));
    await runConciergeTick(ctx.fixture.adapters);
  });

  registry.define(/^it is assigned a musical-form icon from the pool$/, (ctx) => {
    const newTopicId = ctx.fixture.topicMap['a-brand-new-epic'];
    ctx.newIconEntry = ctx.fixture.iconsSet.find((s) => s.topicId === newTopicId);
    if (!ctx.newIconEntry) {
      throw new Error(`expected the new epic topic to have an icon set, got: ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });

  registry.define(/^that icon differs from every already-assigned epic icon while the pool has unused slots$/, (ctx) => {
    if (ctx.alreadyAssignedIconIds.includes(ctx.newIconEntry.iconId)) {
      throw new Error(`expected the new epic's icon (${ctx.newIconEntry.iconId}) to differ from every already-assigned icon (${JSON.stringify(ctx.alreadyAssignedIconIds)})`);
    }
  });

  // ── epic-icon-disjoint-03 (pure constants) ─────────────────────────────
  registry.define(/^the ticket-state icons and standing-topic icons already in use$/, () => {
    // Non-behavioral: the real ICON_EMOJI/STANDING_TOPIC_ICON constants are
    // read directly by the Then step below.
  });

  registry.define(/^the epic musical-form pool is resolved$/, () => {
    // Non-behavioral: EPIC_ICON_POOL is a static constant, nothing to
    // resolve per-scenario - the Then step below checks it directly.
  });

  registry.define(/^no epic pool icon equals any ticket-state icon or standing-topic icon$/, () => {
    const reserved = new Set([...Object.values(ICON_EMOJI), ...Object.values(STANDING_TOPIC_ICON)]);
    for (const icon of EPIC_ICON_POOL) {
      if (reserved.has(icon)) {
        throw new Error(`expected the epic pool to never collide with a ticket-state or standing-topic icon, but "${icon}" is shared`);
      }
    }
  });

  // ── epic-icon-live-set-04 ───────────────────────────────────────────────
  registry.define(/^an epic's desired musical-form emoji is absent from Telegram's live forum-topic icon set$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters([]); // no stickers at all
    ctx.fixture.setFolders(folders({
      paused: [epicDefTicket('role-benchmarking', 'Swarm Role Benchmarking')],
      active: [{ id: 'BL-901', title: 'benchmarking slice', epic: 'role-benchmarking' }],
    }));
  });

  registry.define(/^the epic topic's icon is applied$/, async (ctx) => {
    ctx.tickError = undefined;
    try {
      await runConciergeTick(ctx.fixture.adapters);
    } catch (err) {
      ctx.tickError = err;
    }
  });

  registry.define(/^no icon is set on the epic topic and it is left unchanged$/, (ctx) => {
    if (ctx.tickError) {
      throw new Error(`expected the tick to complete without throwing, got: ${ctx.tickError.stack || ctx.tickError}`);
    }
    if (ctx.fixture.iconsSet.length !== 0) {
      throw new Error(`expected no icon to be set when the epic's desired emoji is absent from the live set, got: ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });

  // ── epic-icon-ownership-05 (Scenario Outline) - drives the REAL
  //    syncTopicIcon directly, exactly the mechanism epics reuse ─────────
  registry.define(/^an epic topic whose current icon the swarm "([^"]*)"$/, (ctx, ownership) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_OWNERSHIP, ownership)) {
      throw new Error(`epic-icon-ownership-05: unrecognized <ownership> example value "${ownership}"`);
    }
    ctx.ownership = ownership;
  });

  registry.define(/^the "([^"]*)" evaluates that epic topic$/, async (ctx, pass) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_PASSES, pass)) {
      throw new Error(`epic-icon-ownership-05: unrecognized <pass> example value "${pass}"`);
    }
    const setCalls = [];
    const adapters = {
      getIconStickers: async () => [{ emoji: '🎙', customEmojiId: 'id-mic' }],
      setTopicIcon: async (topicId, iconId) => {
        setCalls.push({ topicId, iconId });
        return true;
      },
      // BL-342/418's own "always eligible" backfill posture: a backfill
      // NEVER consults the real marker - isNewTopic=true (below) is what
      // actually grants eligibility on that pass, mirroring
      // buildAlwaysEligibleIconAdapters exactly.
      readSwarmIconId: () => (ctx.ownership === 'owned' ? 'some-marker-id' : undefined),
      recordSwarmIconId: () => {},
    };
    const isNewTopic = pass === 'backfill';
    await syncTopicIcon('ownership-fixture-epic', 42, '🎙', isNewTopic, adapters);
    ctx.setCalls = setCalls;
  });

  registry.define(/^the epic topic icon is "([^"]*)"$/, (ctx, result) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_RESULTS, result)) {
      throw new Error(`epic-icon-ownership-05: unrecognized <result> example value "${result}"`);
    }
    const wasSet = ctx.setCalls.length > 0;
    if (result === 'set' && !wasSet) {
      throw new Error('expected the epic topic icon to be SET, but setTopicIcon was never called');
    }
    if (result === 'unchanged' && wasSet) {
      throw new Error(`expected the epic topic icon to stay UNCHANGED, but setTopicIcon was called: ${JSON.stringify(ctx.setCalls)}`);
    }
  });
}

module.exports = { registerSteps };
