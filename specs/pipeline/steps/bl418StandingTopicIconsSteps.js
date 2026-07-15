'use strict';

// BL-418: step handlers for "the standing non-ticket topics carry their
// orchestra icons". Scenario 01 drives the REAL compiled
// STANDING_TOPIC_ICON map (extension/out/concierge/topicIcon) directly - a
// pure lookup, no adapters needed. Scenarios 02/03 drive the REAL compiled
// runConciergeTick (extension/out/concierge/conciergeTick) against fake
// in-memory adapters, mirroring extension/test/conciergeTick.test.js's own
// fakeAdapters shape (the same fixture convention BL-342's own
// topicIconsTrackTicketStateSteps.js already established for this exact
// module) - never a hand-rolled substitute for the real sync logic.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const { STANDING_TOPIC_ICON } = require(path.join(EXT_OUT, 'concierge', 'topicIcon'));

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough - so a mutated example value fails loudly instead of
// silently resolving to `undefined` and the assertion comparing
// undefined !== undefined passing for the wrong reason.
const KNOWN_STANDING_TOPICS = { 'support/intake': true, operator: true };

const STANDING_ID = 'STANDING-900';

function folders() {
  return { active: [], paused: [], done: [] };
}

// Mirrors extension/test/conciergeTick.test.js's own fakeAdapters shape,
// extended with readStandingTopics (BL-418).
function fakeConciergeAdapters() {
  const state = { snapshot: null, emittedKeys: [] };
  const iconsSet = [];
  const iconOwnership = {};
  let stickers = [{ emoji: '🎟', customEmojiId: 'id-ticket' }, { emoji: '🏛', customEmojiId: 'id-opera-house' }];
  let standingTargets = [];
  return {
    state,
    iconsSet,
    iconOwnership,
    setStickers: (s) => {
      stickers = s;
    },
    setStandingTargets: (t) => {
      standingTargets = t;
    },
    adapters: {
      readFolders: () => folders(),
      readGates: () => [],
      readRoleTicket: () => ({}),
      readTickState: () => state,
      writeTickState: (next) => {
        state.snapshot = next.snapshot;
        state.emittedKeys = next.emittedKeys;
        state.standingIconSeenIds = next.standingIconSeenIds;
      },
      routeAdapters: {
        getTopicMap: () => ({}),
        createTopic: async () => ({ success: true, topicId: 1 }),
        recordTopicId: () => {},
        sendMessage: async () => true,
        closeTopic: async () => true,
        recordMessage: () => {},
        ensureOperatorTopic: async () => undefined,
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
      readStandingTopics: () => standingTargets,
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the concierge maintains icons for the standing non-ticket topics$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
  });

  // ── standing-topic-icons-01 (Scenario Outline, pure) ─────────────────
  registry.define(/^the "(.+)" standing topic$/, (ctx, topic) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_STANDING_TOPICS, topic)) {
      throw new Error(`standing-topic-icons: unrecognized <topic> example value "${topic}"`);
    }
    ctx.topicKey = topic;
  });

  registry.define(/^its icon is resolved$/, (ctx) => {
    ctx.resolvedIcon = STANDING_TOPIC_ICON[ctx.topicKey];
  });

  // "Then the icon is \"...\"" is a verbatim step-text collision with
  // bl417FeatureTopicIconMusicalNoteSteps.js's own Scenario Outline step
  // (registered earlier in steps/index.js, so it always wins - the same
  // "branch on ctx shape rather than silently shadow" convention
  // needsApprovalSteps.js's own "the backfill runs" collision already
  // uses). That handler now checks ctx.topicKey (set by the Given step
  // above, never present on BL-417's own path) and delegates to
  // ctx.resolvedIcon set here - no registration needed in this file.

  // ── standing-topic-icons-02 ───────────────────────────────────────────
  registry.define(/^a standing topic whose current icon was set by a human, not the swarm$/, (ctx) => {
    // Already in the durable seen-set (simulating one that pre-dates this
    // feature, or was already evaluated once) but carries NO swarm
    // ownership marker - readSwarmIconId undefined is exactly "the swarm
    // did not set this icon" (blTopicStore.ts's own docstring for the
    // field). See conciergeTick.ts's standingIconSeenIds for why "already
    // seen" (not "marker present") is the correct signal that protects a
    // pre-existing, possibly human-customised icon from being overwritten.
    ctx.fixture.state.standingIconSeenIds = [STANDING_ID];
    ctx.fixture.setStandingTargets([{ id: STANDING_ID, topicId: 900, iconKey: 'operator' }]);
  });

  registry.define(/^the concierge evaluates that topic's icon$/, async (ctx) => {
    await runConciergeTick(ctx.fixture.adapters);
  });

  registry.define(/^the concierge leaves the existing icon untouched$/, (ctx) => {
    if (ctx.fixture.iconsSet.length !== 0) {
      throw new Error(`expected no setTopicIcon call for a human-set standing-topic icon, got: ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });

  // ── standing-topic-icons-03 ───────────────────────────────────────────
  registry.define(/^the live topic-icon sticker set does not contain a standing topic's icon$/, (ctx) => {
    // A GENUINELY NEW standing topic (absent from the seen-set) - the
    // sticker-set gap, not ownership, is what this scenario exercises.
    ctx.fixture.setStandingTargets([{ id: STANDING_ID, topicId: 900, iconKey: 'operator' }]);
    ctx.fixture.setStickers([{ emoji: '🎟', customEmojiId: 'id-ticket' }]); // no 🏛
  });

  registry.define(/^the concierge tries to set that topic's icon$/, async (ctx) => {
    ctx.tickError = undefined;
    try {
      await runConciergeTick(ctx.fixture.adapters);
    } catch (err) {
      ctx.tickError = err;
    }
  });

  // "Then no icon is set for that topic and the tick does not fail" is
  // ALSO a verbatim collision with bl417FeatureTopicIconMusicalNoteSteps.js's
  // own scenario 03 - its handler's check (no throw, ctx.fixture.iconsSet
  // empty) applies identically to this ticket's own ctx.fixture/ctx.tickError
  // shape, so no registration is needed here either; see that file's own
  // comment for why the message there stays ticket-neutral.
}

module.exports = { registerSteps };
