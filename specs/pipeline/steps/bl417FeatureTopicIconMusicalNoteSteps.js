'use strict';

// BL-417: step handlers for the feature-in-flight icon remap (bulb -> musical
// note). Drives the REAL resolveIconState/ICON_EMOJI (scenarios 01/02) and
// the REAL runConciergeTick against fake in-memory adapters (scenario 03) -
// mirrors topicIconsTrackTicketStateSteps.js's own established fixture
// shape for this exact module, never a hand-rolled substitute.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { resolveIconState, ICON_EMOJI } = require(path.join(EXT_OUT, 'concierge', 'topicIcon'));
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));

const KNOWN_ICONS = { '✅': 'done', '🦠': 'defect', '🎵': 'feature', '🔍': 'paused' };
// resolveIconState's own signature/branches - epic is deliberately excluded
// (topicIcon.ts: an epic topic is never a target of this resolution).
const KNOWN_FOLDERS = new Set(['active', 'paused', 'done']);
const KNOWN_TYPES = new Set(['bug', 'defect', 'chore', 'enhancement', 'feature']);

const TICKET_ID = 'BL-417-fixture';

const STICKERS_WITH_NOTE = [
  { emoji: '✅', customEmojiId: 'id-check' },
  { emoji: '🦠', customEmojiId: 'id-microbe' },
  { emoji: '🎵', customEmojiId: 'id-note' },
  { emoji: '🔍', customEmojiId: 'id-magnifier' },
];

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

// Same fakeAdapters shape topicIconsTrackTicketStateSteps.js/
// extension/test/conciergeTick.test.js already use for this module.
function fakeConciergeAdapters(stickers) {
  const topicMap = {};
  const iconsSet = [];
  let currentFolders = folders();
  return {
    topicMap,
    iconsSet,
    setFolders: (f) => {
      currentFolders = f;
    },
    adapters: {
      readFolders: () => currentFolders,
      readGates: () => [],
      readRoleTicket: () => ({}),
      readTickState: () => ({ snapshot: null, emittedKeys: [] }),
      writeTickState: () => {},
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
      },
      iconAdapters: {
        getIconStickers: async () => stickers,
        setTopicIcon: async (topicId, iconId) => {
          iconsSet.push({ topicId, iconId });
          return true;
        },
        readSwarmIconId: () => undefined,
        recordSwarmIconId: () => {},
      },
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the concierge resolves a ticket topic's icon from its folder and type$/, () => {
    // Non-behavioral: the real resolveIconState/ICON_EMOJI/runConciergeTick
    // are driven directly by each scenario's own steps below.
  });

  // ── feature-topic-icon-musical-note-01 ─────────────────────────────────
  registry.define(/^an active ticket whose type is not a bug$/, (ctx) => {
    ctx.folder = 'active';
    ctx.type = 'feature';
  });

  registry.define(/^its topic icon is resolved$/, (ctx) => {
    const state = resolveIconState(ctx.folder, ctx.type);
    ctx.resolvedEmoji = ICON_EMOJI[state];
  });

  registry.define(/^the icon is the musical note$/, (ctx) => {
    if (ctx.resolvedEmoji !== '🎵') {
      throw new Error(`expected the musical note, got ${ctx.resolvedEmoji}`);
    }
  });

  // ── feature-topic-icon-musical-note-02 (Scenario Outline) ──────────────
  registry.define(/^a ticket in folder "([^"]*)" whose type is "([^"]*)"$/, (ctx, folder, type) => {
    if (!KNOWN_FOLDERS.has(folder)) {
      throw new Error(`feature-topic-icon-musical-note-02: unrecognized <folder> example value "${folder}"`);
    }
    if (!KNOWN_TYPES.has(type)) {
      throw new Error(`feature-topic-icon-musical-note-02: unrecognized <type> example value "${type}"`);
    }
    ctx.folder = folder;
    ctx.type = type;
  });

  // BL-418: "the icon is \"...\"" is a verbatim step-text collision with
  // bl418StandingTopicIconsSteps.js's own Scenario Outline (standing-topic
  // icons 🎟/🏛, never a member of this ticket's own KNOWN_ICONS) - the same
  // "registered earlier always wins, so branch on ctx shape rather than
  // silently shadow the other registration" convention needsApprovalSteps.js
  // already uses for its own "the backfill runs" collision. ctx.topicKey is
  // BL-418's own Given step's marker, never set on this ticket's path.
  registry.define(/^the icon is "([^"]*)"$/, (ctx, icon) => {
    if (ctx.topicKey !== undefined) {
      if (ctx.resolvedIcon !== icon) {
        throw new Error(`expected the "${ctx.topicKey}" standing topic's icon to be "${icon}", got "${ctx.resolvedIcon}"`);
      }
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(KNOWN_ICONS, icon)) {
      throw new Error(`feature-topic-icon-musical-note-02: unrecognized <icon> example value "${icon}"`);
    }
    if (ctx.resolvedEmoji !== icon) {
      throw new Error(`expected the icon to be ${icon} (${KNOWN_ICONS[icon]}), got ${ctx.resolvedEmoji}`);
    }
  });

  // ── feature-topic-icon-musical-note-03 ──────────────────────────────────
  registry.define(/^the live topic-icon sticker set does not contain the musical note$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters(STICKERS_WITH_NOTE.filter((s) => s.emoji !== '🎵'));
    ctx.fixture.setFolders(folders({ active: [{ id: TICKET_ID, title: 'a fine feature', type: 'feature' }] }));
  });

  registry.define(/^the concierge tries to set a feature topic's icon$/, async (ctx) => {
    ctx.tickError = undefined;
    try {
      await runConciergeTick(ctx.fixture.adapters);
    } catch (err) {
      ctx.tickError = err;
    }
  });

  // BL-418: also a verbatim collision with bl418StandingTopicIconsSteps.js's
  // own scenario 03 Then step - the check itself (no throw, no icon set)
  // applies identically to either ticket's ctx.fixture/ctx.tickError shape,
  // so this one handler serves both without branching; only the message
  // stays ticket-neutral rather than naming "the musical note" specifically.
  registry.define(/^no icon is set for that topic and the tick does not fail$/, (ctx) => {
    if (ctx.tickError) {
      throw new Error(`expected the tick to complete without throwing, got: ${ctx.tickError.stack || ctx.tickError}`);
    }
    if (ctx.fixture.iconsSet.length !== 0) {
      throw new Error(`expected no icon to be set when its sticker is absent from the live sticker set, got: ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });
}

module.exports = { registerSteps };
