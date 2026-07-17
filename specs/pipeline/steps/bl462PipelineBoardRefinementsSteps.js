'use strict';

// BL-462: step handlers for "the pipeline board shows a wider slug, an
// updated-at footer bumped only on content change, and reposts at the
// bottom when its content changes". Drives the REAL compiled
// runConciergeTick/syncPipelineBoard (extension/out/concierge/...) against
// fake in-memory adapters, mirroring bl452/455PipelineBoardSteps.js's own
// fixture convention for this exact module - never a hand-rolled substitute
// for the real board-sync logic. Scenarios about RENDERED CONTENT (slug
// width, footer format, no-side-effects) drive the full concierge tick,
// same as bl452/455; scenarios about the REPOST/DELETE/footer-bump
// MECHANISM itself (refine-04/05/06) call the real compiled
// syncPipelineBoard directly - the exact unit those scenarios describe -
// rather than routing through concierge-tick machinery unrelated to them.
//
// "the pipeline board is rendered" is the SAME step text
// bl452PipelineBoardSteps.js already registers (hardcoded nowMs=0) - reused
// by omission, the same convention bl455PipelineBoardSteps.js's own comment
// documents for this exact step. Scenario refine-03's "known instant" is
// therefore pinned to that same fixed 0 (epoch), not an arbitrary date -
// still a fully deterministic, known instant, just the one the shared step
// actually drives the tick with.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const { computePipelineBoard, deriveTicketSlug, PIPELINE_BOARD_SLUG_MAX_LENGTH, formatUpdatedAtLabel } = require(path.join(
  EXT_OUT,
  'concierge',
  'pipelineBoard'
));
const { syncPipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoardSync'));

// The slug bound BEFORE BL-462 widened it (24 -> current
// PIPELINE_BOARD_SLUG_MAX_LENGTH) - refine-01 needs a title that overflowed
// the OLD bound but fits the new one.
const PREVIOUS_SLUG_MAX_LENGTH = 24;

// The fixed instant the shared "the pipeline board is rendered" step
// (bl452PipelineBoardSteps.js) always drives runConciergeTick with.
const SHARED_TICK_NOW_MS = 0;

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

// Mirrors bl452/455PipelineBoardSteps.js's own fixture shape exactly (same
// property names) so a Then-step registered in EITHER of those files can be
// reused, by omission, against a ctx.fixture this file's own Given steps
// create.
function fakeConciergeAdapters() {
  const state = { snapshot: null, emittedKeys: [] };
  const topicMap = {};
  const posted = [];
  const edited = [];
  const deleted = [];
  const recordedTopicIds = [];
  const recordedMessages = [];
  let currentFolders = folders();
  let currentRoleHeldTickets = {};
  return {
    state,
    topicMap,
    posted,
    edited,
    deleted,
    recordedTopicIds,
    recordedMessages,
    setFolders: (f) => {
      currentFolders = f;
    },
    setRoleHeldTickets: (rt) => {
      currentRoleHeldTickets = rt;
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
        state.pipelineBoard = next.pipelineBoard;
      },
      routeAdapters: {
        getTopicMap: () => topicMap,
        createTopic: async () => ({ success: true, topicId: 800 + Object.keys(topicMap).length + recordedTopicIds.length + 1 }),
        recordTopicId: (backlogId, topicId) => {
          topicMap[backlogId] = topicId;
          recordedTopicIds.push({ backlogId, topicId });
        },
        sendMessage: async () => true,
        closeTopic: async () => true,
        recordMessage: (backlogId, text) => {
          recordedMessages.push({ backlogId, text });
        },
        ensureOperatorTopic: async () => 700,
        ensureApprovalsTopic: async () => 750,
      },
      iconAdapters: {
        getIconStickers: async () => [],
        setTopicIcon: async () => true,
        readSwarmIconId: () => undefined,
        recordSwarmIconId: () => {},
      },
      readStandingTopics: () => [],
      readRoleHeldTickets: () => currentRoleHeldTickets,
      boardAdapters: {
        ensureBoardTopic: async () => ({ topicId: 900 }),
        postMessage: async (topicId, text) => {
          posted.push({ topicId, text });
          return { messageId: posted.length };
        },
        deleteMessage: async (topicId, messageId) => {
          deleted.push({ topicId, messageId });
          return true;
        },
      },
    },
  };
}

function lastPosted(fixture) {
  if (fixture.posted.length === 0) {
    throw new Error('expected the board to have been posted at least once, got none');
  }
  return fixture.posted[fixture.posted.length - 1].text;
}

// refine-04/05/06 drive syncPipelineBoard directly - a narrower adapter
// fixture than fakeConciergeAdapters above, since these scenarios are about
// the sync mechanism itself, not concierge-tick's folder/role-held wiring.
function fakeBoardAdapters() {
  const posted = [];
  const deleted = [];
  return {
    posted,
    deleted,
    adapters: {
      ensureBoardTopic: async () => ({ topicId: 900 }),
      postMessage: async (topicId, text) => {
        posted.push({ topicId, text });
        return { messageId: posted.length };
      },
      deleteMessage: async (topicId, messageId) => {
        deleted.push({ topicId, messageId });
        return true;
      },
    },
  };
}

const BOARD_STATE_A = () => computePipelineBoard({ coder: ['BL-1'] }, [], {});
const BOARD_STATE_B = () => computePipelineBoard({ QA: ['BL-1'] }, [], {});

const KNOWN_CONTENT = new Set(['changed', 'unchanged']);
const KNOWN_REPOST = new Set(['reposted at the bottom', 'left in place']);
const KNOWN_FOOTER_TIME = new Set(['bumped', 'unchanged']);

function registerSteps(registry) {
  registry.define(/^a pipeline board rendered from the active tickets, the parked list, and an injected clock$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
  });

  // ── pipeline-board-refine-01 ──────────────────────────────────────────
  registry.define(/^an active ticket whose title is longer than the previous slug limit but within the wider limit$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.ticketId = 'BL-1';
    ctx.ticketTitle = 'a'.repeat(PREVIOUS_SLUG_MAX_LENGTH + 10);
    if (ctx.ticketTitle.length > PIPELINE_BOARD_SLUG_MAX_LENGTH) {
      throw new Error('fixture bug: expected the title to fit within the wider limit');
    }
    ctx.fixture.setRoleHeldTickets({ coder: [ctx.ticketId] });
    ctx.fixture.setFolders(folders({ active: [{ id: ctx.ticketId, title: ctx.ticketTitle }] }));
  });

  registry.define(/^the ticket's row shows a slug carrying more of its title than the previous limit allowed$/, (ctx) => {
    const expectedSlug = deriveTicketSlug(ctx.ticketTitle);
    if (expectedSlug.length <= PREVIOUS_SLUG_MAX_LENGTH) {
      throw new Error(`fixture bug: expected a slug longer than the previous limit, got length ${expectedSlug.length}`);
    }
    const text = lastPosted(ctx.fixture);
    if (!text.includes(expectedSlug)) {
      throw new Error(`expected the rendered board to include the widened slug "${expectedSlug}", got:\n${text}`);
    }
  });

  registry.define(/^the slug is still a single line no wider than the board$/, (ctx) => {
    const expectedSlug = deriveTicketSlug(ctx.ticketTitle);
    if (expectedSlug.includes('\n')) {
      throw new Error(`expected a single-line slug, got: ${JSON.stringify(expectedSlug)}`);
    }
    if (expectedSlug.length > PIPELINE_BOARD_SLUG_MAX_LENGTH) {
      throw new Error(`expected the slug to be at most ${PIPELINE_BOARD_SLUG_MAX_LENGTH} chars, got ${expectedSlug.length}`);
    }
  });

  // pipeline-board-refine-02 RETIRED (BL-475): its step handlers asserted
  // the GRID row contains deriveTicketSlug(title), a premise BL-465
  // superseded (the grid now shows a short kebab slug, never a truncated
  // title) - see the feature file's own retirement comment for why.

  // ── pipeline-board-refine-03 ──────────────────────────────────────────
  registry.define(/^the board content changes at a known instant$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleHeldTickets({ coder: ['BL-3'] });
    ctx.knownInstant = SHARED_TICK_NOW_MS;
  });

  registry.define(/^the board ends with an "updated at" footer showing that instant as month, day, hour and minute$/, (ctx) => {
    const text = lastPosted(ctx.fixture);
    const expectedFooter = `updated at ${formatUpdatedAtLabel(ctx.knownInstant)}`;
    if (!text.endsWith(expectedFooter)) {
      throw new Error(`expected the board to end with "${expectedFooter}", got:\n${text}`);
    }
  });

  // ── pipeline-board-refine-04 (Scenario Outline) ───────────────────────
  registry.define(/^a board already posted in the topic$/, async (ctx) => {
    ctx.board = fakeBoardAdapters();
    ctx.t1 = Date.UTC(2026, 6, 16, 20, 5);
    ctx.firstResult = await syncPipelineBoard(BOARD_STATE_A(), undefined, ctx.board.adapters, ctx.t1);
  });

  registry.define(/^the board content "([^"]+)" since it was last posted$/, (ctx, content) => {
    if (!KNOWN_CONTENT.has(content)) {
      throw new Error(`pipeline-board-refine-04: unrecognized <content> example value "${content}"`);
    }
    ctx.nextData = content === 'changed' ? BOARD_STATE_B() : BOARD_STATE_A();
  });

  registry.define(/^the board sync runs at a later instant$/, async (ctx) => {
    ctx.t2 = Date.UTC(2026, 6, 16, 20, 6);
    ctx.secondResult = await syncPipelineBoard(ctx.nextData, ctx.firstResult.state, ctx.board.adapters, ctx.t2);
  });

  registry.define(/^the board is "([^"]+)"$/, (ctx, repost) => {
    if (!KNOWN_REPOST.has(repost)) {
      throw new Error(`pipeline-board-refine-04: unrecognized <repost> example value "${repost}"`);
    }
    const expectReposted = repost === 'reposted at the bottom';
    if (expectReposted) {
      if (ctx.board.deleted.length !== 1) {
        throw new Error(`expected the old message deleted exactly once, got ${ctx.board.deleted.length}`);
      }
      if (ctx.board.posted.length !== 2) {
        throw new Error(`expected a second, fresh message posted, got ${ctx.board.posted.length}`);
      }
      if (ctx.secondResult.outcome !== 'reposted') {
        throw new Error(`expected outcome 'reposted', got ${ctx.secondResult.outcome}`);
      }
    } else {
      if (ctx.board.deleted.length !== 0) {
        throw new Error(`expected no delete for an unchanged board, got ${ctx.board.deleted.length}`);
      }
      if (ctx.board.posted.length !== 1) {
        throw new Error(`expected no second post for an unchanged board, got ${ctx.board.posted.length}`);
      }
      if (ctx.secondResult.outcome !== 'skipped-unchanged') {
        throw new Error(`expected outcome 'skipped-unchanged', got ${ctx.secondResult.outcome}`);
      }
    }
  });

  registry.define(/^the footer time is "([^"]+)"$/, (ctx, footerTime) => {
    if (!KNOWN_FOOTER_TIME.has(footerTime)) {
      throw new Error(`pipeline-board-refine-04: unrecognized <footer_time> example value "${footerTime}"`);
    }
    const expectedLastChangeMs = footerTime === 'bumped' ? ctx.t2 : ctx.t1;
    if (ctx.secondResult.state.lastChangeMs !== expectedLastChangeMs) {
      throw new Error(`expected lastChangeMs=${expectedLastChangeMs}, got ${ctx.secondResult.state.lastChangeMs}`);
    }
  });

  // ── pipeline-board-refine-05 ──────────────────────────────────────────
  registry.define(/^no board message has been posted yet$/, (ctx) => {
    ctx.board = fakeBoardAdapters();
  });

  registry.define(/^the board sync runs and posts the board$/, async (ctx) => {
    ctx.t1 = Date.UTC(2026, 6, 16, 20, 5);
    ctx.result = await syncPipelineBoard(BOARD_STATE_A(), undefined, ctx.board.adapters, ctx.t1);
  });

  registry.define(/^no prior board message is deleted$/, (ctx) => {
    if (ctx.board.deleted.length !== 0) {
      throw new Error(`expected no delete on the very first post, got ${ctx.board.deleted.length}`);
    }
    if (ctx.result.outcome !== 'posted') {
      throw new Error(`expected outcome 'posted', got ${ctx.result.outcome}`);
    }
  });

  registry.define(/^the board content later changes and the board sync runs again$/, async (ctx) => {
    ctx.t2 = Date.UTC(2026, 6, 16, 20, 6);
    ctx.result2 = await syncPipelineBoard(BOARD_STATE_B(), ctx.result.state, ctx.board.adapters, ctx.t2);
  });

  registry.define(/^the previously posted board message is deleted$/, (ctx) => {
    if (ctx.board.deleted.length !== 1) {
      throw new Error(`expected exactly one delete, got ${ctx.board.deleted.length}`);
    }
    if (ctx.board.deleted[0].messageId !== ctx.result.state.messageId) {
      throw new Error(`expected the FIRST message deleted (id ${ctx.result.state.messageId}), got messageId=${ctx.board.deleted[0].messageId}`);
    }
  });

  registry.define(/^a new board message is posted so the board is the latest message in the topic$/, (ctx) => {
    if (ctx.board.posted.length !== 2) {
      throw new Error(`expected exactly two posts total, got ${ctx.board.posted.length}`);
    }
    if (ctx.result2.outcome !== 'reposted') {
      throw new Error(`expected outcome 'reposted', got ${ctx.result2.outcome}`);
    }
    if (ctx.result2.state.messageId === ctx.result.state.messageId) {
      throw new Error('expected a DIFFERENT (fresh) messageId, never the deleted one reused');
    }
  });

  // ── pipeline-board-refine-06 ───────────────────────────────────────────
  registry.define(/^a board whose content is unchanged across two ticks$/, async (ctx) => {
    ctx.board = fakeBoardAdapters();
    ctx.t1 = Date.UTC(2026, 6, 16, 20, 5);
    ctx.firstResult = await syncPipelineBoard(BOARD_STATE_A(), undefined, ctx.board.adapters, ctx.t1);
    ctx.unchangedData = BOARD_STATE_A();
  });

  registry.define(/^the injected clock advances between the ticks$/, (ctx) => {
    ctx.t2 = Date.UTC(2026, 6, 16, 21, 30);
    if (!(ctx.t2 > ctx.t1)) {
      throw new Error('fixture bug: expected the second instant to be later than the first');
    }
  });

  registry.define(/^the board sync runs on the second tick$/, async (ctx) => {
    ctx.secondResult = await syncPipelineBoard(ctx.unchangedData, ctx.firstResult.state, ctx.board.adapters, ctx.t2);
  });

  registry.define(/^the board is not reposted$/, (ctx) => {
    if (ctx.board.posted.length !== 1 || ctx.board.deleted.length !== 0) {
      throw new Error(`expected no repost, got posted=${ctx.board.posted.length} deleted=${ctx.board.deleted.length}`);
    }
    if (ctx.secondResult.outcome !== 'skipped-unchanged') {
      throw new Error(`expected outcome 'skipped-unchanged', got ${ctx.secondResult.outcome}`);
    }
  });

  registry.define(/^the footer time still shows the instant of the last content change$/, (ctx) => {
    if (ctx.secondResult.state.lastChangeMs !== ctx.t1) {
      throw new Error(`expected lastChangeMs to stay at the first change (${ctx.t1}), got ${ctx.secondResult.state.lastChangeMs}`);
    }
  });

  // ── pipeline-board-refine-07 ───────────────────────────────────────────
  // "no ticket, handoff, or backlog state is modified by the board" reuses
  // bl452PipelineBoardSteps.js's own registration (identical text) - the
  // board's read-only claim holds identically post-BL-462.
  registry.define(/^active tickets span several stages and a board already posted$/, async (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleHeldTickets({ coder: ['BL-1'], QA: ['BL-2'], architect: ['BL-3'] });
    await runConciergeTick(ctx.fixture.adapters, SHARED_TICK_NOW_MS);
  });

  registry.define(/^the board is rendered and synced$/, async (ctx) => {
    await runConciergeTick(ctx.fixture.adapters, SHARED_TICK_NOW_MS);
  });
}

module.exports = { registerSteps };
