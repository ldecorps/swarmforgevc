'use strict';

// BL-342: step handlers for "A topic's icon tells the truth about its
// ticket's state". Drives the REAL compiled runConciergeTick
// (extension/out/concierge/conciergeTick) against fake in-memory adapters
// for scenarios 01-05, topicIcon.ts's own resolveIconStickerId directly for
// scenario 06, and the REAL compiled backfillTopicIcons
// (extension/out/tools/backfill-topic-icons) against a real fixture repo +
// fake Telegram postFn for scenario 07 - never a hand-rolled substitute for
// any of the real logic under test.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const { resolveIconStickerId } = require(path.join(EXT_OUT, 'concierge', 'topicIcon'));
const { backfillTopicIcons } = require(path.join(EXT_OUT, 'tools', 'backfill-topic-icons'));

// BL-417: feature-in-flight remapped from the bulb to the musical note.
const STICKERS = [
  { emoji: '✅', customEmojiId: 'id-check' },
  { emoji: '🦠', customEmojiId: 'id-microbe' },
  { emoji: '🎵', customEmojiId: 'id-note' },
  { emoji: '🔍', customEmojiId: 'id-magnifier' },
];

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

// Mirrors extension/test/conciergeTick.test.js's own fakeAdapters shape -
// the same fixture convention already established for this exact module.
function fakeConciergeAdapters() {
  const state = { snapshot: null, emittedKeys: [] };
  const topicMap = {};
  const iconsSet = [];
  const iconOwnership = {};
  let currentFolders = folders();
  return {
    state,
    topicMap,
    iconsSet,
    iconOwnership,
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
      },
      routeAdapters: {
        getTopicMap: () => topicMap,
        createTopic: async (name) => {
          const topicId = 800 + Object.keys(topicMap).length + 1;
          return { success: true, topicId };
        },
        recordTopicId: (backlogId, topicId) => {
          topicMap[backlogId] = topicId;
        },
        sendMessage: async () => true,
        closeTopic: async () => true,
        recordMessage: () => {},
        ensureOperatorTopic: async () => 700,
      },
      iconAdapters: {
        getIconStickers: async () => STICKERS,
        setTopicIcon: async (topicId, iconId) => {
          iconsSet.push({ topicId, iconId });
          return true;
        },
        readSwarmIconId: (ticketId) => iconOwnership[ticketId],
        recordSwarmIconId: (ticketId, iconId) => {
          iconOwnership[ticketId] = iconId;
        },
      },
    },
  };
}

function iconFor(fixture, backlogId) {
  const topicId = fixture.topicMap[backlogId];
  const set = fixture.iconsSet.filter((s) => s.topicId === topicId);
  return set.length > 0 ? set[set.length - 1].iconId : undefined;
}

const TICKET_ID = 'BL-900';

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^tickets whose topics are listed together and never hidden$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
  });

  // ── topic-icons-track-ticket-state-01 ────────────────────────────────
  registry.define(/^a ticket with no topic yet$/, (ctx) => {
    ctx.fixture.setFolders(folders({ active: [{ id: TICKET_ID, title: 'a fine feature', type: 'feature' }] }));
  });

  registry.define(/^its topic is created$/, async (ctx) => {
    await runConciergeTick(ctx.fixture.adapters);
  });

  registry.define(/^the topic has an icon reflecting the ticket's state$/, (ctx) => {
    const icon = iconFor(ctx.fixture, TICKET_ID);
    if (icon !== 'id-note') {
      throw new Error(`expected the new topic's icon to reflect its in-flight feature state (id-note), got ${icon}`);
    }
  });

  // ── topic-icons-track-ticket-state-02 (Scenario Outline) ─────────────
  const KNOWN_STATES = {
    done: { folders: { done: [{ id: TICKET_ID, title: 't', type: 'feature' }] }, expectedIcon: 'id-check' },
    'in flight': { folders: { active: [{ id: TICKET_ID, title: 't', type: 'feature' }] }, expectedIcon: 'id-note' },
    paused: { folders: { paused: [{ id: TICKET_ID, title: 't', type: 'feature' }] }, expectedIcon: 'id-magnifier' },
  };

  registry.define(/^a ticket whose topic has an icon set by the swarm$/, (ctx) => {
    // Established directly (not via a real tick in any ONE of the three
    // example folders) so that WHICHEVER of done/in-flight/paused the
    // Scenario Outline's own When step drives next is a genuine, fresh
    // "newly entering that folder" transition - state.snapshot stays null,
    // so newlyEnteredIds treats entry into ANY folder as new. Pinning this
    // Given to (say) "active" would make the "in flight" example a no-op
    // (already active), exactly the bug this fixture avoids.
    ctx.fixture.topicMap[TICKET_ID] = 900;
    ctx.fixture.iconOwnership[TICKET_ID] = 'id-check';
  });

  registry.define(/^the ticket becomes (.+)$/, async (ctx, newState) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_STATES, newState)) {
      throw new Error(`topic-icons-track-ticket-state: unrecognized <new_state> example value "${newState}"`);
    }
    ctx.fixture.setFolders(folders(KNOWN_STATES[newState].folders));
    ctx.expectedIcon = KNOWN_STATES[newState].expectedIcon;
    await runConciergeTick(ctx.fixture.adapters);
  });

  registry.define(/^the topic's icon is updated to reflect that state$/, (ctx) => {
    const icon = iconFor(ctx.fixture, TICKET_ID);
    if (icon !== ctx.expectedIcon) {
      throw new Error(`expected the topic's icon to become ${ctx.expectedIcon}, got ${icon}`);
    }
  });

  // ── topic-icons-track-ticket-state-03 ────────────────────────────────
  registry.define(/^a ticket whose topic has been closed$/, async (ctx) => {
    // A topic closes as part of the SAME TaskCompleted routing that would
    // set its icon - simulated here as "already done once", then bounced
    // back to active (so it has a real, closed-then-reopened topic) before
    // the scenario's own When drives it to done again. closeTopic in this
    // fixture is a no-op recorder (real closing is topicRouter.ts's own,
    // already-tested concern) - what matters here is that syncTopicIcon has
    // no closed/open concept of its own at all (verified at the client
    // layer: editForumTopic is documented to succeed on a closed topic).
    ctx.fixture.setFolders(folders({ active: [{ id: TICKET_ID, title: 't', type: 'feature' }] }));
    await runConciergeTick(ctx.fixture.adapters);
    ctx.fixture.setFolders(folders({ done: [{ id: TICKET_ID, title: 't', type: 'feature' }] }));
    await runConciergeTick(ctx.fixture.adapters);
    ctx.fixture.iconsSet.length = 0;
    // Re-open the scenario at "active" so the shared "becomes done" step
    // below observes a genuine transition once more.
    ctx.fixture.setFolders(folders({ active: [{ id: TICKET_ID, title: 't', type: 'feature' }] }));
    await runConciergeTick(ctx.fixture.adapters);
    ctx.fixture.iconsSet.length = 0;
  });

  // "When the ticket becomes done" reuses the SAME KNOWN_VALUES handler
  // registered above ("the ticket becomes (.+)") - scenario 03's own When
  // step text is a literal match of that pattern's "done" example.

  // ── topic-icons-track-ticket-state-04/05 ─────────────────────────────
  registry.define(/^a topic whose icon was set by a human$/, (ctx) => {
    // No swarm marker recorded at all - the swarm has no way to
    // distinguish "a human set this" from any other unowned icon (no live
    // read API exists), and by design treats both identically: leave it
    // alone. topicId assigned directly (never via createTopic) so this
    // topic is NOT brand new from the tick's own perspective.
    ctx.fixture.topicMap[TICKET_ID] = 555;
  });

  registry.define(/^a topic whose icon the swarm did not set$/, (ctx) => {
    ctx.fixture.topicMap[TICKET_ID] = 555;
  });

  registry.define(/^the ticket's state changes$/, async (ctx) => {
    ctx.fixture.setFolders(folders({ done: [{ id: TICKET_ID, title: 't', type: 'feature' }] }));
    await runConciergeTick(ctx.fixture.adapters);
  });

  registry.define(/^the topic's icon is left as the human set it$/, (ctx) => {
    if (ctx.fixture.iconsSet.length !== 0) {
      throw new Error(`expected the swarm to never call setTopicIcon for a human-set icon, got: ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });

  registry.define(/^the topic's icon is left alone$/, (ctx) => {
    if (ctx.fixture.iconsSet.length !== 0) {
      throw new Error(`expected the swarm to never call setTopicIcon for an icon of unknown origin, got: ${JSON.stringify(ctx.fixture.iconsSet)}`);
    }
  });

  // ── topic-icons-track-ticket-state-06 ────────────────────────────────
  registry.define(/^an icon that Telegram does not allow$/, (ctx) => {
    ctx.disallowedEmoji = '🏆';
    ctx.validatedIconId = undefined;
    ctx.validationAttempted = false;
  });

  registry.define(/^a topic's icon is set$/, (ctx) => {
    ctx.validationAttempted = true;
    ctx.validatedIconId = resolveIconStickerId(STICKERS, ctx.disallowedEmoji);
  });

  registry.define(/^the icon is rejected before the topic is changed$/, (ctx) => {
    if (!ctx.validationAttempted) {
      throw new Error('expected the icon to actually have been validated');
    }
    if (ctx.validatedIconId !== undefined) {
      throw new Error(`expected an emoji absent from the real sticker set to resolve to no id, got ${ctx.validatedIconId}`);
    }
  });

  // ── topic-icons-track-ticket-state-07 ────────────────────────────────
  registry.define(/^many topics whose icons must be backfilled$/, (ctx) => {
    ctx.target = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl342-backfill-'));
    execFileSync('git', ['init', '-q'], { cwd: ctx.target });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: ctx.target });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: ctx.target });
    execFileSync('git', ['commit', '-q', '-m', 'init', '--allow-empty'], { cwd: ctx.target });

    const topicMap = {};
    const activeDir = path.join(ctx.target, 'backlog', 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    ctx.ticketIds = [];
    for (let i = 1; i <= 26; i++) {
      const id = `BL-${i}`;
      ctx.ticketIds.push(id);
      fs.writeFileSync(path.join(activeDir, `${id}.yaml`), `id: ${id}\ntitle: ticket ${i}\ntype: feature\n`);
      topicMap[id] = 100 + i;
    }
    const mapDir = path.join(ctx.target, '.swarmforge', 'operator');
    fs.mkdirSync(mapDir, { recursive: true });
    fs.writeFileSync(path.join(mapDir, 'backlog-topic-map.json'), JSON.stringify(topicMap));
  });

  registry.define(/^the rate limit is reached partway through$/, (ctx) => {
    ctx.editCallsBeforeRateLimit = 19;
  });

  // BL-342: "the backfill runs" is NOT registered as its own step here - it
  // collides verbatim with needsApprovalSteps.js's own BL-251 step of the
  // identical text (a genuine step-text collision between two unrelated
  // tickets' feature files, not a naming choice either side controls).
  // Registration order means needsApprovalSteps.js's own handler always
  // wins; per this project's own established convention for exactly this
  // shape (noInboundMessageIsEverLostSteps.js's "the failure is escalated
  // to the human" branches on which ctx shape is present to serve two
  // tickets from one handler), that handler branches to runIconBackfill
  // below when it sees THIS scenario's own ctx shape (ctx.target),
  // instead of a second, silently-shadowed registration here.
  registry.define(/^it waits as instructed and continues$/, (ctx) => {
    if (!ctx.waits.includes(26000)) {
      throw new Error(`expected a wait of exactly retry_after (26s = 26000ms), got: ${JSON.stringify(ctx.waits)}`);
    }
  });

  registry.define(/^every topic ends with the icon its state calls for$/, (ctx) => {
    if (ctx.outcomes.length !== ctx.ticketIds.length) {
      throw new Error(`expected all ${ctx.ticketIds.length} topics processed, got ${ctx.outcomes.length}`);
    }
    const notUpdated = ctx.outcomes.filter((o) => o.outcome !== 'updated');
    if (notUpdated.length > 0) {
      throw new Error(`expected every topic to end up updated, none silently dropped - found: ${JSON.stringify(notUpdated)}`);
    }
  });
}

// BL-342: the actual "run the backfill" logic for scenario 07, called from
// needsApprovalSteps.js's own "the backfill runs" handler once it detects
// THIS scenario's ctx shape (ctx.target present) - see the registerSteps
// comment above for why this is not registered as a step here directly.
async function runIconBackfill(ctx) {
  let editCalls = 0;
  ctx.waits = [];
  const postFn = async (url) => {
    if (url.endsWith('/getForumTopicIconStickers')) {
      return { ok: true, status: 200, json: { ok: true, result: STICKERS.map((s) => ({ emoji: s.emoji, custom_emoji_id: s.customEmojiId })) } };
    }
    editCalls += 1;
    if (editCalls === ctx.editCallsBeforeRateLimit + 1) {
      return { ok: false, status: 429, json: { ok: false, description: 'Too Many Requests: retry after 26', parameters: { retry_after: 26 } } };
    }
    return { ok: true, status: 200, json: { ok: true, result: true } };
  };
  ctx.outcomes = await backfillTopicIcons(ctx.target, 'fake-token', 'fake-chat', async (ms) => ctx.waits.push(ms), postFn);
}

module.exports = { registerSteps, runIconBackfill };
