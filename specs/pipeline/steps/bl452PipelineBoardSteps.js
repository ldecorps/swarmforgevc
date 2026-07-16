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
const { renderPipelineBoard, renderPipelineBoardBody } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

// BL-462: every scenario below drives runConciergeTick with nowMs=0 (see the
// "the pipeline board is rendered"/"the concierge tick runs again" steps),
// so every expected-text recomputation below passes the SAME fixed instant
// as the second renderPipelineBoard argument - never a bare real clock read,
// which would make a byte-for-byte comparison against the real sync's own
// footer flaky by construction.
const FIXED_NOW_MS = 0;

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough - each entry seeds the fixture for that <state>.
const KNOWN_STATES = {
  'held by the coder': (id, fixture) => fixture.setRoleHeldTickets({ coder: [id] }),
  'held by QA': (id, fixture) => fixture.setRoleHeldTickets({ QA: [id] }),
  parked: (id, fixture) => fixture.setFolders(folders({ paused: [{ id }] })),
  'awaiting approval': (id, fixture) => fixture.setFolders(folders({ paused: [{ id, humanApproval: 'pending' }] })),
};

// BL-455: 'parked'/'awaiting-approval' are no longer grid columns (they
// moved to the below-grid list) - dropped from the known-values set so a
// Gherkin mutation into either string is correctly treated as unrecognized,
// not silently accepted as a once-real column.
const KNOWN_COLUMNS = new Set(['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA', 'coordinator']);

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
  // BL-462: the board no longer edits in place - `edited` stays permanently
  // empty (no adapter populates it anymore) so any OLDER step below that
  // still reads it fails an honest "expected 1, got 0" rather than
  // crashing on a renamed/missing field. See the SUPERSEDED comment on the
  // "edited in place" Then-step further down.
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
        ensureBoardTopic: async () => 900,
        postMessage: async (topicId, text) => {
          posted.push({ topicId, text });
          return 1;
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
  if (fixture.edited.length > 0) {
    return fixture.edited[fixture.edited.length - 1].text;
  }
  if (fixture.posted.length > 0) {
    return fixture.posted[fixture.posted.length - 1].text;
  }
  throw new Error('expected the board to have been posted or edited at least once, got neither');
}

function registerSteps(registry) {
  // ── pipeline-board-01 ─────────────────────────────────────────────────
  registry.define(/^active tickets are at various pipeline stages$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleHeldTickets({ coder: ['BL-1'], QA: ['BL-2'] });
    ctx.expectedBoard = boardData([
      { id: 'BL-1', column: 'coder' },
      { id: 'BL-2', column: 'QA' },
    ]);
  });

  registry.define(/^the pipeline board is rendered$/, async (ctx) => {
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

  // ── pipeline-board-03 ──────────────────────────────────────────────────
  // BL-462 SUPERSEDED: this scenario's own premise (a stage change edits the
  // existing board message IN PLACE) no longer holds - BL-462 replaced the
  // board's edit-in-place mechanism with delete-old + post-fresh-at-the-
  // bottom (pipelineBoardSync.ts), while approvalsRosterSync.ts keeps
  // editing in place unchanged. The two Then-steps below now fail HONESTLY
  // (0 edits, 1 new post) rather than being rewritten to quietly assert the
  // new behavior under old Gherkin wording - retiring/amending this
  // scenario's text is a spec change (specifier/Gherkin), outside the
  // coder's lane (constitution Article 1.9 / engineering.prompt). The prior-
  // state SEED below is still kept in the NEW state shape
  // (contentSignature/lastChangeMs, not the old renderedText) purely so the
  // change-gate itself behaves correctly (a stage change is correctly
  // detected as a real content change) rather than accidentally always
  // "changed" (undefined contentSignature never equals a real one), which
  // would have let a real regression hide behind a mis-shaped fixture.
  registry.define(/^the board has already been posted in the Pipeline Board topic$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleHeldTickets({ coder: ['BL-1'] });
    ctx.fixture.state.pipelineBoard = {
      topicId: 900,
      messageId: 1,
      contentSignature: renderPipelineBoardBody(boardData([{ id: 'BL-1', column: 'coder' }])),
      lastChangeMs: FIXED_NOW_MS,
    };
  });

  registry.define(/^a ticket moves to the next stage and the board is rendered again$/, async (ctx) => {
    ctx.fixture.setRoleHeldTickets({ QA: ['BL-1'] });
    await runConciergeTick(ctx.fixture.adapters, 0);
  });

  registry.define(/^the existing board message is edited in place to show the ticket's new stage$/, (ctx) => {
    if (ctx.fixture.edited.length !== 1) {
      throw new Error(`expected exactly one edit, got ${ctx.fixture.edited.length}: ${JSON.stringify(ctx.fixture.edited)}`);
    }
    const [edit] = ctx.fixture.edited;
    if (edit.topicId !== 900 || edit.messageId !== 1) {
      throw new Error(`expected the edit to target the existing topic 900 / message 1, got topicId=${edit.topicId} messageId=${edit.messageId}`);
    }
    const expected = renderPipelineBoard(boardData([{ id: 'BL-1', column: 'QA' }]), FIXED_NOW_MS);
    if (edit.text !== expected) {
      throw new Error(`expected the edited text to show BL-1 in QA:\n${expected}\ngot:\n${edit.text}`);
    }
  });

  registry.define(/^no new board message is posted$/, (ctx) => {
    if (ctx.fixture.posted.length !== 0) {
      throw new Error(`expected no new message posted, got: ${JSON.stringify(ctx.fixture.posted)}`);
    }
  });

  // ── pipeline-board-04 ──────────────────────────────────────────────────
  registry.define(/^the board has been posted and no ticket's stage has changed$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleHeldTickets({ coder: ['BL-1'] });
    ctx.fixture.state.pipelineBoard = {
      topicId: 900,
      messageId: 1,
      contentSignature: renderPipelineBoardBody(boardData([{ id: 'BL-1', column: 'coder' }])),
      lastChangeMs: FIXED_NOW_MS,
    };
  });

  registry.define(/^the concierge tick runs again$/, async (ctx) => {
    await runConciergeTick(ctx.fixture.adapters, 0);
  });

  registry.define(/^the board message is not edited$/, (ctx) => {
    if (ctx.fixture.edited.length !== 0) {
      throw new Error(`expected no edit for an unchanged board, got: ${JSON.stringify(ctx.fixture.edited)}`);
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
