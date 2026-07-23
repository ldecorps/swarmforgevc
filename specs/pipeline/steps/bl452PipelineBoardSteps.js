'use strict';

// BL-452: step handlers for "a live pipeline-board grid in a dedicated
// Telegram topic shows where each ticket is". Drives the REAL compiled
// runConciergeTick (extension/out/concierge/conciergeTick) against fake
// in-memory adapters, mirroring extension/test/conciergeTick.test.js's own
// fakeAdapters shape (the same fixture convention BL-342/BL-414/BL-418's own
// step handlers already established for this exact module) - never a
// hand-rolled substitute for the real board-sync logic. Every assertion
// below computes its expected grid text via the REAL compiled
// renderPipelineBoard rather than re-deriving the grid's own formatting
// rules here (mirrors bl414TopicTitleAgeSuffixSteps.js's own
// composeTitleWithAge reuse).
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));
const { renderPipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));
// BL-464: "the pipeline board is rendered" is VERBATIM identical to this
// file's own step text below - since this file registers FIRST (index.js
// order), the registry's first-match-wins resolve() means this handler
// owns the text for BOTH tickets' scenarios. ctx.fixture (set only by THIS
// file's own Given steps) distinguishes the two - a BL-464 scenario's ctx
// never has it, so it delegates rather than crashing on
// ctx.fixture.adapters of undefined (mirrors
// aDroppedMessageMustNotParkTheOffsetSteps.js's own identical-collision fix).
const { renderPipelineBoardForFixtureRoot } = require('./bl464PipelineBoardAuthoritativeStageSourceSteps');
// BL-465: a THIRD ctx shape shares this exact step text - its own Given
// steps never set ctx.fixture OR ctx.root (unlike BL-464's, which always
// sets ctx.root = mkTmp() for its real-fs fixture), so ctx.root's absence
// is what tells a BL-465 scenario apart from a BL-464 one, both otherwise
// looking like "no ctx.fixture" to this file.
const { render: renderForBl465 } = require('./bl465PipelineBoardRenderRound2Steps');

// BL-462: every scenario below drives runConciergeTick with nowMs=0 (see the
// "the pipeline board is rendered" step), so every expected-text
// recomputation below passes the SAME fixed instant as the second
// renderPipelineBoard argument - never a bare real clock read, which would
// make a byte-for-byte comparison against the real sync's own footer flaky
// by construction.
const FIXED_NOW_MS = 0;

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough - each entry seeds the fixture for that <state>.
// BL-510: a role-held id also needs an active/ row (BL-473 made grid
// membership exactly `folders.active`, never role-held alone - a
// role-held-only fixture now renders no row at all).
const KNOWN_STATES = {
  'held by the coder': (id, fixture) => {
    fixture.setRoleHeldTickets({ coder: [id] });
    fixture.setFolders(folders({ active: [{ id }] }));
  },
  'held by QA': (id, fixture) => {
    fixture.setRoleHeldTickets({ QA: [id] });
    fixture.setFolders(folders({ active: [{ id }] }));
  },
  // BL-507: a ticket physically in backlog/active/ whose authoritative
  // stage is the coordinator (the brief post-QA bookkeeping window) - its
  // row is remapped to the QA column at render time (see the "marked only
  // in the QA column" assertion this state feeds), never its own column.
  'held by the coordinator': (id, fixture) => {
    fixture.setRoleHeldTickets({ coordinator: [id] });
    fixture.setFolders(folders({ active: [{ id }] }));
  },
  parked: (id, fixture) => fixture.setFolders(folders({ paused: [{ id }] })),
  'awaiting approval': (id, fixture) => fixture.setFolders(folders({ paused: [{ id, humanApproval: 'pending' }] })),
};

// BL-455: 'parked'/'awaiting-approval' are no longer grid columns (they
// moved to the below-grid list) - dropped from the known-values set so a
// Gherkin mutation into either string is correctly treated as unrecognized,
// not silently accepted as a once-real column.
// BL-507: 'coordinator' dropped too - the grid carries no coordinator
// column any more (a coordinator-held ticket now asserts the 'QA' column
// instead), so no scenario's <column> example value can legitimately be
// 'coordinator' - a mutation into it is correctly unrecognized.
const KNOWN_COLUMNS = new Set(['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']);

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

// Mirrors extension/test/conciergeTick.test.js's own fakeAdapters shape,
// narrowed to what this feature's scenarios actually exercise.
// routeAdapters (per-TICKET topics) stay non-throwing, real-succeeding
// stubs - an "awaiting approval" paused ticket legitimately drives the
// PRE-EXISTING ApprovalRequested event (BL-408) through this same tick,
// which is unrelated to the board but genuinely does open/post to a
// per-ticket topic; the board's own "touches no ticket state" claim
// (pipeline-board-05) is checked by asserting these tracking arrays stay
// empty, never by making the stub throw.
function fakeConciergeAdapters() {
  const state = { snapshot: null, emittedKeys: [] };
  const topicMap = {};
  const posted = [];
  const deleted = [];
  const recordedTopicIds = [];
  const recordedMessages = [];
  let currentFolders = folders();
  let currentRoleHeldTickets = {};
  return {
    state,
    topicMap,
    posted,
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
        createTopic: async (name) => ({ success: true, topicId: 800 + Object.keys(topicMap).length + recordedTopicIds.length + 1 }),
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
        // BL-493: runConciergeTick's own TaskStarted/TaskCompleted
        // derivation reaches the ticket's status-line routing
        // unconditionally now - this feature's own scenarios don't assert
        // on it, so a safe no-op-tracking default is enough.
        ensureBacklogTopic: async () => 760,
        postMessage: async () => 9000,
        editMessage: async () => true,
        getTicketMessageState: () => undefined,
        setTicketMessageState: () => {},
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
          return { messageId: 1 };
        },
        deleteMessage: async (topicId, messageId) => {
          deleted.push({ topicId, messageId });
          return true;
        },
      },
    },
  };
}

// BL-455 widened PipelineBoardRow with epic/slug and renderPipelineBoard's
// own input from a bare row array to { rows, parked }. This suite's own
// fixtures never set a ticket title/epic (KNOWN_STATES only calls
// setRoleHeldTickets/setFolders), so every expected row here carries the
// same epic: undefined, slug: '' the real join would also produce for an id
// with no matching backlog item - never a hand-rolled substitute for
// computePipelineBoard's own (separately unit-tested) defaults.
function boardData(rows) {
  return { rows: rows.map((r) => ({ epic: undefined, slug: '', ...r })), parked: [] };
}

function lastRendered(fixture) {
  if (fixture.posted.length > 0) {
    return fixture.posted[fixture.posted.length - 1].text;
  }
  throw new Error('expected the board to have been posted at least once, got none');
}

function registerSteps(registry) {
  // ── pipeline-board-01 (also seeds pipeline-board-05, the read-only-
  // guarantee scenario below - same Given, shared by both) ───────────────
  // BL-510: same folders.active gap as KNOWN_STATES above (BL-473 made grid
  // membership exactly `folders.active`, never role-held alone) - this
  // scenario's own dedicated Given calls setRoleHeldTickets directly rather
  // than going through KNOWN_STATES, so it needed the identical fix.
  //
  // Populating folders.active alone would regress pipeline-board-05
  // ("...modifies no swarm state"): runConciergeTick's TaskStarted
  // derivation (deriveSwarmEvents, swarmEventStream.ts) diffs the tick's
  // PRIOR snapshot against the current one, and a fresh `state.snapshot ===
  // null` baseline makes BL-1/BL-2 look like a brand-new empty->active
  // transition, firing TaskStarted -> routeTicketStatusEvent ->
  // recordMessage for both - exactly the per-ticket write pipeline-board-05
  // asserts never happens. So the Given also pre-seeds state.snapshot as
  // though BL-1/BL-2 were ALREADY active on a previous tick (the same
  // {backlog, gates, roleTicket, ticketSummaries, pendingApproval} shape
  // toEventStreamSnapshot itself builds) - the diff then sees no
  // transition, TaskStarted never fires, and recordMessage/recordedTopicIds
  // stay empty, while the board's OWN render (a direct, non-diffed read of
  // the CURRENT folders.active) still shows both rows correctly.
  registry.define(/^active tickets are at various pipeline stages$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleHeldTickets({ coder: ['BL-1'], QA: ['BL-2'] });
    ctx.fixture.setFolders(folders({ active: [{ id: 'BL-1' }, { id: 'BL-2' }] }));
    ctx.fixture.state.snapshot = {
      backlog: { active: ['BL-1', 'BL-2'], paused: [], done: [] },
      gates: [],
      roleTicket: {},
      ticketSummaries: {},
      pendingApproval: [],
    };
    ctx.expectedBoard = boardData([
      { id: 'BL-1', column: 'coder' },
      { id: 'BL-2', column: 'QA' },
    ]);
  });

  registry.define(/^the pipeline board is rendered$/, async (ctx) => {
    if (ctx.fixture === undefined && ctx.root === undefined) {
      // BL-465's own ctx shape - see this file's own top-of-file comment.
      renderForBl465(ctx);
      return;
    }
    if (ctx.fixture === undefined) {
      // BL-464's own ctx shape (its Given steps never set ctx.fixture) -
      // see this file's own top-of-file comment.
      renderPipelineBoardForFixtureRoot(ctx);
      return;
    }
    await runConciergeTick(ctx.fixture.adapters, 0);
  });

  registry.define(/^each active ticket is a row in the board$/, (ctx) => {
    const expected = renderPipelineBoard(ctx.expectedBoard, FIXED_NOW_MS);
    const actual = lastRendered(ctx.fixture);
    if (actual !== expected) {
      throw new Error(`expected board:\n${expected}\ngot:\n${actual}`);
    }
  });

  registry.define(/^each ticket's row has a single mark in the column for its current stage$/, (ctx) => {
    const expected = renderPipelineBoard(ctx.expectedBoard, FIXED_NOW_MS);
    const actual = lastRendered(ctx.fixture);
    if (actual !== expected) {
      throw new Error(`expected board:\n${expected}\ngot:\n${actual}`);
    }
  });

  registry.define(/^a role holding no ticket shows no mark in that ticket's row$/, (ctx) => {
    const expected = renderPipelineBoard(ctx.expectedBoard, FIXED_NOW_MS);
    const actual = lastRendered(ctx.fixture);
    if (actual !== expected) {
      throw new Error(`expected board:\n${expected}\ngot:\n${actual}`);
    }
  });

  // ── pipeline-board-02 (Scenario Outline) ──────────────────────────────
  registry.define(/^ticket "([^"]+)" is "([^"]+)"$/, (ctx, id, state) => {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_STATES, state)) {
      throw new Error(`pipeline-board-02: unrecognized <state> example value "${state}"`);
    }
    ctx.fixture = fakeConciergeAdapters();
    KNOWN_STATES[state](id, ctx.fixture);
  });

  registry.define(/^ticket "([^"]+)" is marked only in the "([^"]+)" column$/, (ctx, id, column) => {
    if (!KNOWN_COLUMNS.has(column)) {
      throw new Error(`pipeline-board-02: unrecognized <column> example value "${column}"`);
    }
    const expected = renderPipelineBoard(boardData([{ id, column }]), FIXED_NOW_MS);
    const actual = lastRendered(ctx.fixture);
    if (actual !== expected) {
      throw new Error(`expected board:\n${expected}\ngot:\n${actual}`);
    }
  });

  // ── pipeline-board-05 ──────────────────────────────────────────────────
  registry.define(/^the pipeline board is rendered and posted$/, async (ctx) => {
    await runConciergeTick(ctx.fixture.adapters, 0);
  });

  registry.define(/^no ticket, handoff, or backlog state is modified by the board$/, (ctx) => {
    // The Given for this scenario sets only readRoleHeldTickets (no
    // folders.active/paused ticket), so none of the PRE-EXISTING
    // per-ticket event machinery (TaskStarted/TaskCompleted/
    // ApprovalRequested) has anything to fire on either - these tracking
    // arrays staying empty proves the board sync itself never reaches the
    // per-ticket topic-map or message-record stores.
    if (ctx.fixture.recordedTopicIds.length !== 0) {
      throw new Error(`expected no per-ticket topic mapping written by the board sync, got: ${JSON.stringify(ctx.fixture.recordedTopicIds)}`);
    }
    if (ctx.fixture.recordedMessages.length !== 0) {
      throw new Error(`expected no per-ticket message recorded by the board sync, got: ${JSON.stringify(ctx.fixture.recordedMessages)}`);
    }
    if (Object.keys(ctx.fixture.topicMap).length !== 0) {
      throw new Error(`expected no per-ticket topic mapping written by the board sync, got: ${JSON.stringify(ctx.fixture.topicMap)}`);
    }
  });
}

module.exports = { registerSteps };
