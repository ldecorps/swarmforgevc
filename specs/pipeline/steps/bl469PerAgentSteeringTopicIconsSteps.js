'use strict';

// BL-469: step handlers for "the per-agent Telegram steering topics (BL-425)
// carry their fixed, human-chosen icons". Drives the REAL compiled
// runConciergeTick (extension/out/concierge/conciergeTick) against fake
// in-memory adapters, mirroring extension/test/conciergeTick.test.js's own
// fakeAdapters shape - the same "drive the real sync logic, never a
// hand-rolled substitute" convention bl418StandingTopicIconsSteps.js already
// established for the sibling standing-topic icon sync this ticket reuses
// (syncTopicIcon itself, via conciergeTick.ts's own syncPerAgentTopicIcons).
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const { ROLE_TOPIC_ICON } = require(path.join(EXT_OUT, 'concierge', 'topicIcon'));
const { ALL_SWARM_ROLES } = require(path.join(EXT_OUT, 'concierge', 'roleTopicMapStore'));

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_ROLES = new Set(ALL_SWARM_ROLES);
const KNOWN_ICONS = new Set(Object.values(ROLE_TOPIC_ICON));

function folders() {
  return { active: [], paused: [], done: [] };
}

// Mirrors extension/test/conciergeTick.test.js's own fakeAdapters shape,
// extended with readRoleTopics (BL-469) rather than readStandingTopics.
function fakeConciergeAdapters() {
  const state = { snapshot: null, emittedKeys: [] };
  const iconsSet = [];
  const iconOwnership = {};
  let stickers = Object.values(ROLE_TOPIC_ICON).map((emoji, i) => ({ emoji, customEmojiId: `id-${i}` }));
  let roleTargets = [];
  return {
    state,
    iconsSet,
    iconOwnership,
    setStickers: (s) => {
      stickers = s;
    },
    setRoleTargets: (t) => {
      roleTargets = t;
    },
    adapters: {
      readFolders: () => folders(),
      readGates: () => [],
      readRoleTicket: () => ({}),
      readTickState: () => state,
      writeTickState: (next) => {
        state.snapshot = next.snapshot;
        state.emittedKeys = next.emittedKeys;
        state.roleIconSeenIds = next.roleIconSeenIds;
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
      readRoleTopics: () => roleTargets,
    },
  };
}

// Deterministic topicId per role (1001-based, in ALL_SWARM_ROLES order) -
// stable across scenarios since KNOWN_ROLES is a fixed set.
function targetsForAllRoles() {
  return ALL_SWARM_ROLES.map((role, i) => ({ role, topicId: 1001 + i }));
}

function topicIdForRole(role) {
  return 1001 + ALL_SWARM_ROLES.indexOf(role);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the swarm owns a per-agent steering topic for each of its eight roles$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleTargets(targetsForAllRoles());
  });

  // ── per-agent-steering-topic-icon-01 (Scenario Outline) ──────────────
  registry.define(/^Telegram's live sticker set offers the icon "([^"]*)"$/, (ctx, icon) => {
    if (!KNOWN_ICONS.has(icon)) {
      throw new Error(`per-agent-steering-topic-icon: unrecognized <icon> example value "${icon}"`);
    }
    ctx.fixture.setStickers([{ emoji: icon, customEmojiId: `id-${icon}` }]);
  });

  registry.define(/^the per-agent steering-topic icon sync runs for the newly-owned topics$/, async (ctx) => {
    await runConciergeTick(ctx.fixture.adapters);
  });

  registry.define(/^the "([^"]*)" steering topic icon is set to "([^"]*)"$/, (ctx, role, icon) => {
    if (!KNOWN_ROLES.has(role)) {
      throw new Error(`per-agent-steering-topic-icon: unrecognized <role> example value "${role}"`);
    }
    if (!KNOWN_ICONS.has(icon)) {
      throw new Error(`per-agent-steering-topic-icon: unrecognized <icon> example value "${icon}"`);
    }
    const topicId = topicIdForRole(role);
    const match = ctx.fixture.iconsSet.find((s) => s.topicId === topicId && s.iconId === `id-${icon}`);
    if (!match) {
      throw new Error(`expected the "${role}" steering topic (topic ${topicId}) to have its icon set to "${icon}"; got ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });

  // ── per-agent-steering-topic-icon-02 ──────────────────────────────────
  registry.define(/^Telegram's live sticker set does NOT offer the coder's mapped icon$/, (ctx) => {
    ctx.fixture.setStickers(
      Object.entries(ROLE_TOPIC_ICON)
        .filter(([role]) => role !== 'coder')
        .map(([role, emoji]) => ({ emoji, customEmojiId: `id-${role}` }))
    );
  });

  registry.define(/^it offers every other role's mapped icon$/, () => {
    // No-op: the Given step above already seeded every OTHER role's sticker;
    // this step exists purely for the scenario's own readability (mirrors
    // bl425RoleSteeringTopicsSteps.js's own "the ... And ..." pairing
    // convention where the second clause documents rather than mutates).
  });

  registry.define(/^the coder steering topic icon sync outcome is "skipped-unresolved-icon"$/, (ctx) => {
    // conciergeTick.ts's syncPerAgentTopicIcons (like its standing-topic
    // sibling) discards syncTopicIcon's own return value - it is a
    // best-effort, fire-and-forget call. So "skipped-unresolved-icon" is
    // asserted here via the ONLY side effects that outcome (as opposed to
    // 'updated' or 'failed') can produce: no setTopicIcon call recorded for
    // the coder's topic, and no ownership marker recorded for it either.
    // 'skipped-not-owned' cannot apply (isNewTopic is always true for a
    // newly-entering role), so these two side effects are exactly, and
    // only, what "skipped-unresolved-icon" looks like from the outside.
    const coderTopicId = topicIdForRole('coder');
    if (ctx.fixture.iconsSet.some((s) => s.topicId === coderTopicId)) {
      throw new Error(`expected no icon to be set for the coder topic (unresolved sticker); got ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
    if (ctx.fixture.iconOwnership.coder !== undefined) {
      throw new Error(`expected no ownership marker recorded for the coder topic; got ${JSON.stringify(ctx.fixture.iconOwnership.coder)}`);
    }
  });

  registry.define(/^every other role's steering topic icon is set to its mapped icon$/, (ctx) => {
    const missing = ALL_SWARM_ROLES.filter((role) => role !== 'coder').filter((role) => {
      const topicId = topicIdForRole(role);
      return !ctx.fixture.iconsSet.some((s) => s.topicId === topicId && s.iconId === `id-${role}`);
    });
    if (missing.length !== 0) {
      throw new Error(`expected every non-coder role to have its own mapped icon set; missing: ${JSON.stringify(missing)}, got ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });

  // ── per-agent-steering-topic-icon-03 ──────────────────────────────────
  registry.define(/^every per-agent steering topic already carries its mapped icon set by the swarm$/, (ctx) => {
    // The change-gate that protects an already-synced role topic from a
    // steady-state re-edit is the durable roleIconSeenIds set (mirrors
    // standingIconSeenIds - see syncPerAgentTopicIcons' own docstring), not
    // the ownership marker below; the ownership marker is set too purely to
    // make the fixture's "already set by the swarm" narrative concrete.
    ctx.fixture.state.roleIconSeenIds = ALL_SWARM_ROLES.slice();
    for (const role of ALL_SWARM_ROLES) {
      ctx.fixture.iconOwnership[role] = `id-${role}`;
    }
  });

  registry.define(/^the per-agent steering-topic icon sync runs again on an unchanged tick$/, async (ctx) => {
    await runConciergeTick(ctx.fixture.adapters);
  });

  registry.define(/^no per-agent steering topic icon is re-edited$/, (ctx) => {
    if (ctx.fixture.iconsSet.length !== 0) {
      throw new Error(`expected no setTopicIcon call on a steady-state tick; got ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });
}

module.exports = { registerSteps };
