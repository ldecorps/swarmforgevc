'use strict';

// BL-414: step handlers for "a topic's title shows how long ago it was last
// updated". Drives the REAL compiled runConciergeTick
// (extension/out/concierge/conciergeTick) against fake in-memory adapters,
// mirroring extension/test/conciergeTick.test.js's own fakeAdapters shape
// (the same fixture convention BL-342/BL-418's own step handlers already
// established for this exact module) - never a hand-rolled substitute for
// the real title-age sync logic. Scenario 04's own assertions drive the
// REAL compiled composeTitleWithAge (extension/out/concierge/topicTitleAge)
// to compute the expected suffix text, rather than duplicating its
// formatting rules here.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const { composeTitleWithAge } = require(path.join(EXT_OUT, 'concierge', 'topicTitleAge'));

const HOUR_MS = 60 * 60 * 1000;

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_BUCKET_ELAPSED_MS = {
  fresh: 30 * 60 * 1000,
  hours: 5 * HOUR_MS,
  day: 30 * HOUR_MS,
  stale: 100 * HOUR_MS,
};

const TICKET_ID = 'BL-777';
const TOPIC_ID = 900;
const BASE_TITLE = 'a fine feature';

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

// Mirrors extension/test/conciergeTick.test.js's own fakeAdapters shape,
// narrowed to what this feature's scenarios actually exercise.
function fakeConciergeAdapters() {
  const state = { snapshot: null, emittedKeys: [] };
  const topicMap = {};
  const titlesSet = [];
  const lastActivityByTicket = {};
  let currentFolders = folders();
  return {
    state,
    topicMap,
    titlesSet,
    setFolders: (f) => {
      currentFolders = f;
    },
    setLastActivityMs: (ticketId, ms) => {
      lastActivityByTicket[ticketId] = ms;
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
        getIconStickers: async () => [],
        setTopicIcon: async () => true,
        readSwarmIconId: () => undefined,
        recordSwarmIconId: () => {},
      },
      readStandingTopics: () => [],
      titleAdapters: {
        readLastActivityMs: (ticketId) => lastActivityByTicket[ticketId],
        setTopicTitle: async (topicId, title) => {
          titlesSet.push({ topicId, title });
          return true;
        },
      },
    },
  };
}

function lastTitle(ctx) {
  const set = ctx.fixture.titlesSet;
  if (set.length === 0) {
    throw new Error('expected at least one title edit, got none');
  }
  return set[set.length - 1].title;
}

function knownBucket(scenarioName, exampleField, value) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_BUCKET_ELAPSED_MS, value)) {
    throw new Error(`${scenarioName}: unrecognized <${exampleField}> example value "${value}"`);
  }
  return value;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a concierge tick maintaining a topic title with an age suffix reflecting its last-update time$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
  });

  // ── topic-title-age-suffix-01 (Scenario Outline) / -02 (shares the Given)
  registry.define(/^a topic whose last-announced staleness bucket is "(.+)"$/, (ctx, prevBucket) => {
    knownBucket('topic-title-age-suffix', 'prev', prevBucket);
    ctx.fixture.setFolders(folders({ active: [{ id: TICKET_ID, title: BASE_TITLE }] }));
    ctx.fixture.topicMap[TICKET_ID] = TOPIC_ID;
    ctx.fixture.state.titleAgeBuckets = { [TICKET_ID]: prevBucket };
  });

  // -01: crossing into a genuinely different bucket.
  registry.define(/^a tick finds its time since last update now in bucket "(.+)"$/, async (ctx, nowBucket) => {
    knownBucket('topic-title-age-suffix', 'now', nowBucket);
    const nowMs = KNOWN_BUCKET_ELAPSED_MS[nowBucket];
    ctx.fixture.setLastActivityMs(TICKET_ID, 0);
    ctx.lastElapsedMs = nowMs;
    await runConciergeTick(ctx.fixture.adapters, nowMs);
  });

  registry.define(/^the topic title is edited once to carry the "(.+)" age suffix$/, (ctx, bucket) => {
    knownBucket('topic-title-age-suffix', 'now', bucket);
    if (ctx.fixture.titlesSet.length !== 1) {
      throw new Error(`expected exactly one title edit, got: ${JSON.stringify(ctx.fixture.titlesSet)}`);
    }
    const expected = composeTitleWithAge(BASE_TITLE, bucket, ctx.lastElapsedMs);
    const actual = lastTitle(ctx);
    if (actual !== expected) {
      throw new Error(`expected title "${expected}", got "${actual}"`);
    }
  });

  registry.define(/^the last-announced staleness bucket for that topic becomes "(.+)"$/, (ctx, bucket) => {
    knownBucket('topic-title-age-suffix', 'now', bucket);
    const actual = ctx.fixture.state.titleAgeBuckets[TICKET_ID];
    if (actual !== bucket) {
      throw new Error(`expected the persisted bucket to become "${bucket}", got "${actual}"`);
    }
  });

  // -02: the bucket does not change.
  registry.define(/^a tick finds its time since last update still in bucket "(.+)"$/, async (ctx, sameBucket) => {
    knownBucket('topic-title-age-suffix', 'now', sameBucket);
    ctx.fixture.setLastActivityMs(TICKET_ID, 0);
    await runConciergeTick(ctx.fixture.adapters, KNOWN_BUCKET_ELAPSED_MS[sameBucket]);
  });

  registry.define(/^the topic title is not edited$/, (ctx) => {
    if (ctx.fixture.titlesSet.length !== 0) {
      throw new Error(`expected no title edit for an unchanged bucket, got: ${JSON.stringify(ctx.fixture.titlesSet)}`);
    }
  });

  registry.define(/^the last-announced staleness bucket for that topic stays "(.+)"$/, (ctx, bucket) => {
    knownBucket('topic-title-age-suffix', 'now', bucket);
    const actual = ctx.fixture.state.titleAgeBuckets[TICKET_ID];
    if (actual !== bucket) {
      throw new Error(`expected the persisted bucket to stay "${bucket}", got "${actual}"`);
    }
  });

  // ── topic-title-age-suffix-03 (reuses the "last-announced ... is" Given
  //    above with prev="stale") ──────────────────────────────────────────
  registry.define(/^the topic receives new activity and a tick runs$/, async (ctx) => {
    const nowMs = 100 * HOUR_MS;
    const lastUpdateMs = nowMs - 30 * 60 * 1000; // new activity 30 minutes before "now" - fresh
    ctx.fixture.setLastActivityMs(TICKET_ID, lastUpdateMs);
    ctx.lastElapsedMs = nowMs - lastUpdateMs;
    await runConciergeTick(ctx.fixture.adapters, nowMs);
  });

  // Deliberately distinct text from "...edited ONCE to carry..." above (no
  // "once") - the feature file's own wording for this scenario.
  registry.define(/^the topic title is edited to carry the "(.+)" age suffix$/, (ctx, bucket) => {
    knownBucket('topic-title-age-suffix', 'now', bucket);
    const expected = composeTitleWithAge(BASE_TITLE, bucket, ctx.lastElapsedMs);
    const actual = lastTitle(ctx);
    if (actual !== expected) {
      throw new Error(`expected title "${expected}", got "${actual}"`);
    }
  });

  // ── topic-title-age-suffix-04 ─────────────────────────────────────────
  registry.define(/^a topic whose base title is "(.+)" carrying an age suffix$/, (ctx, baseTitle) => {
    // Feeds an ALREADY-suffixed string as the folder item's own title - the
    // defensive case decideTitleAge's own stripAgeSuffix exists for (a base
    // title source that, for whatever reason, still carries a stale
    // suffix), exercised through the real wiring rather than only the pure
    // module directly.
    ctx.baseTitle = baseTitle;
    ctx.fixture.setFolders(folders({ active: [{ id: TICKET_ID, title: `${baseTitle} · 3h ago` }] }));
    ctx.fixture.topicMap[TICKET_ID] = TOPIC_ID;
    ctx.fixture.state.titleAgeBuckets = { [TICKET_ID]: 'hours' };
  });

  registry.define(/^a tick edits the title for a new staleness bucket$/, async (ctx) => {
    const nowMs = KNOWN_BUCKET_ELAPSED_MS.day;
    ctx.fixture.setLastActivityMs(TICKET_ID, 0);
    await runConciergeTick(ctx.fixture.adapters, nowMs);
  });

  registry.define(/^the resulting title still begins with "(.+)"$/, (ctx, prefix) => {
    const actual = lastTitle(ctx);
    if (!actual.startsWith(prefix)) {
      throw new Error(`expected title to begin with "${prefix}", got "${actual}"`);
    }
  });

  registry.define(/^it carries exactly one age suffix, not an accumulation of stale ones$/, (ctx) => {
    const actual = lastTitle(ctx);
    const suffixCount = actual.split(' · ').length - 1;
    if (suffixCount !== 1) {
      throw new Error(`expected exactly one age suffix, got ${suffixCount} in "${actual}"`);
    }
  });
}

module.exports = { registerSteps };
