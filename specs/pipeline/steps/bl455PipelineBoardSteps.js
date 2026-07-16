'use strict';

// BL-455: step handlers for "the pipeline board groups tickets by epic,
// lists parked tickets below the grid, and shows a slug per ticket". Drives
// the REAL compiled runConciergeTick (extension/out/concierge/conciergeTick)
// against fake in-memory adapters, mirroring extension/test/
// conciergeTick.test.js's own fakeAdapters shape (the same fixture
// convention BL-452's own bl452PipelineBoardSteps.js already established
// for this exact module) - never a hand-rolled substitute for the real
// board-sync logic. The "ticket "<id>" is "<state>"" Given and "the pipeline
// board is rendered" When steps are the SAME step text bl452PipelineBoardSteps.js
// already registers for BL-452's own outline - the step registry resolves
// generic step text to whichever registration matches first (stepRegistry.js),
// which is safe here because both files drive the identical behavior
// (fixture.setRoleHeldTickets / runConciergeTick), never a divergent one.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { runConciergeTick } = require(path.join(EXT_OUT, 'concierge', 'conciergeTick'));

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough.
const KNOWN_PLACEMENTS = new Set(['stage grid', 'below-grid parked list']);

function folders(overrides = {}) {
  return { active: [], paused: [], done: [], ...overrides };
}

// Mirrors extension/test/conciergeTick.test.js's own fakeAdapters shape,
// narrowed to what this feature's scenarios actually exercise. routeAdapters
// (per-TICKET topics) stay non-throwing, real-succeeding stubs for the same
// reason bl452PipelineBoardSteps.js's own fixture does: an "awaiting
// approval" paused ticket legitimately drives the PRE-EXISTING
// ApprovalRequested event (BL-408) through this same tick, unrelated to the
// board itself.
function fakeConciergeAdapters() {
  const state = { snapshot: null, emittedKeys: [] };
  const topicMap = {};
  const posted = [];
  const edited = [];
  const recordedTopicIds = [];
  const recordedMessages = [];
  let currentFolders = folders();
  let currentRoleHeldTickets = {};
  return {
    state,
    topicMap,
    posted,
    edited,
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
        editMessage: async (topicId, messageId, text) => {
          edited.push({ topicId, messageId, text });
          return true;
        },
      },
    },
  };
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

// The board text splits into a stage-grid half and a below-grid parked half
// at the 'PARKED:' section header pipelineBoard.ts's own renderParkedSection
// emits (absent entirely when nothing is parked). Grid data rows always
// start with the ticket id as their first whitespace-delimited token
// (id.padEnd(idWidth) is the row's first cell); parked list rows put the
// status glyph first and the id second ("  PK BL-436 slug words...") - both
// positions are stable regardless of how many words a multi-word slug
// contributes after them, so a slug's own content can never shift where the
// id token lands.
function splitBoardSections(text) {
  const lines = text.split('\n');
  const parkedHeaderIndex = lines.findIndex((l) => l.trim() === 'PARKED:');
  const gridLines = parkedHeaderIndex === -1 ? lines : lines.slice(0, parkedHeaderIndex);
  const parkedLines = parkedHeaderIndex === -1 ? [] : lines.slice(parkedHeaderIndex + 1);
  return { gridLines, parkedLines };
}

function idInGrid(gridLines, id) {
  return gridLines.some((l) => l.trim().split(/\s+/)[0] === id);
}

function idInParkedList(parkedLines, id) {
  return parkedLines.some((l) => l.trim().split(/\s+/)[1] === id);
}

function registerSteps(registry) {
  // ── pipeline-board-epic-01 ──────────────────────────────────────────────
  registry.define(/^active tickets belong to different epics$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleHeldTickets({ coder: ['BL-1'], architect: ['BL-2'], QA: ['BL-3'] });
    ctx.fixture.setFolders(
      folders({
        active: [
          { id: 'BL-1', title: 'first', epic: 'Alpha' },
          { id: 'BL-2', title: 'second', epic: 'Alpha' },
          { id: 'BL-3', title: 'third', epic: 'Beta' },
        ],
      })
    );
  });

  registry.define(/^some active tickets belong to no epic$/, (ctx) => {
    ctx.fixture.setRoleHeldTickets({ ...ctx.fixture.adapters.readRoleHeldTickets(), hardender: ['BL-4'] });
    const prevFolders = ctx.fixture.adapters.readFolders();
    ctx.fixture.setFolders(folders({ active: [...prevFolders.active, { id: 'BL-4', title: 'fourth' }] }));
  });

  registry.define(/^tickets that share an epic are grouped together under that epic$/, (ctx) => {
    const text = lastRendered(ctx.fixture);
    const lines = text.split('\n');
    const alphaHeadingIndex = lines.findIndex((l) => l.trim() === '-- Alpha --');
    if (alphaHeadingIndex === -1) {
      throw new Error(`expected an "-- Alpha --" epic heading, got:\n${text}`);
    }
    if (!lines[alphaHeadingIndex + 1].startsWith('BL-1') || !lines[alphaHeadingIndex + 2].startsWith('BL-2')) {
      throw new Error(`expected BL-1 and BL-2 directly under the Alpha heading, got:\n${text}`);
    }
  });

  registry.define(/^tickets with no epic are grouped together$/, (ctx) => {
    const text = lastRendered(ctx.fixture);
    const lines = text.split('\n');
    const noEpicHeadingCount = lines.filter((l) => l.trim() === '-- (no epic) --').length;
    if (noEpicHeadingCount !== 1) {
      throw new Error(`expected exactly one "-- (no epic) --" heading, got ${noEpicHeadingCount} in:\n${text}`);
    }
  });

  // ── pipeline-board-epic-02 (Scenario Outline) ───────────────────────────
  // "ticket "<id>" is "<state>"" and "the pipeline board is rendered" reuse
  // bl452PipelineBoardSteps.js's own registrations - same text, same
  // behavior (setRoleHeldTickets / setFolders via KNOWN_STATES, then
  // runConciergeTick), so this file only adds the new <placement> Then step.
  registry.define(/^ticket "([^"]+)" appears in the "([^"]+)"$/, (ctx, id, placement) => {
    if (!KNOWN_PLACEMENTS.has(placement)) {
      throw new Error(`pipeline-board-epic-02: unrecognized <placement> example value "${placement}"`);
    }
    const { gridLines, parkedLines } = splitBoardSections(lastRendered(ctx.fixture));
    const inGrid = idInGrid(gridLines, id);
    const inParked = idInParkedList(parkedLines, id);
    const expectInGrid = placement === 'stage grid';
    if (inGrid !== expectInGrid || inParked === expectInGrid) {
      throw new Error(
        `expected ticket ${id} to appear in exactly the "${placement}" (inGrid=${inGrid}, inParked=${inParked})`
      );
    }
  });

  // ── pipeline-board-epic-03 ──────────────────────────────────────────────
  registry.define(/^a parked ticket and an awaiting-approval ticket$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.parkedId = 'BL-436';
    ctx.awaitingId = 'BL-449';
    ctx.fixture.setFolders(
      folders({
        paused: [
          { id: ctx.parkedId, title: 'stalled work' },
          { id: ctx.awaitingId, title: 'needs a decision', humanApproval: 'pending' },
        ],
      })
    );
  });

  registry.define(/^neither ticket appears as a row inside the stage grid$/, (ctx) => {
    const { gridLines } = splitBoardSections(lastRendered(ctx.fixture));
    if (idInGrid(gridLines, ctx.parkedId) || idInGrid(gridLines, ctx.awaitingId)) {
      throw new Error(`expected neither ${ctx.parkedId} nor ${ctx.awaitingId} in the stage grid`);
    }
  });

  registry.define(/^both tickets appear in the parked list below the grid$/, (ctx) => {
    const { parkedLines } = splitBoardSections(lastRendered(ctx.fixture));
    if (!idInParkedList(parkedLines, ctx.parkedId) || !idInParkedList(parkedLines, ctx.awaitingId)) {
      throw new Error(`expected both ${ctx.parkedId} and ${ctx.awaitingId} in the below-grid parked list`);
    }
  });

  // ── pipeline-board-epic-04 ──────────────────────────────────────────────
  registry.define(/^an active ticket with a title$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.ticketId = 'BL-5';
    ctx.ticketTitle = 'Fix pipeline board grouping';
    ctx.fixture.setRoleHeldTickets({ coder: [ctx.ticketId] });
    ctx.fixture.setFolders(folders({ active: [{ id: ctx.ticketId, title: ctx.ticketTitle }] }));
  });

  registry.define(/^the ticket's row shows a short slug derived from its title$/, (ctx) => {
    // BL-455's own deriveTicketSlug is the real production derivation - this
    // reuses it (not a hand-rolled re-implementation) to compute the exact
    // expected slug, then confirms the wiring actually threaded the title
    // through to the rendered row.
    const { deriveTicketSlug } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));
    ctx.expectedSlug = deriveTicketSlug(ctx.ticketTitle);
    const text = lastRendered(ctx.fixture);
    if (!text.includes(ctx.expectedSlug)) {
      throw new Error(`expected the rendered board to include the derived slug "${ctx.expectedSlug}", got:\n${text}`);
    }
  });

  registry.define(/^the slug is a single line no wider than the board$/, (ctx) => {
    const { PIPELINE_BOARD_SLUG_MAX_LENGTH } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));
    if (ctx.expectedSlug.includes('\n')) {
      throw new Error(`expected the slug to be a single line, got: ${JSON.stringify(ctx.expectedSlug)}`);
    }
    if (ctx.expectedSlug.length > PIPELINE_BOARD_SLUG_MAX_LENGTH) {
      throw new Error(`expected the slug to be at most ${PIPELINE_BOARD_SLUG_MAX_LENGTH} chars, got ${ctx.expectedSlug.length}`);
    }
  });

  // ── pipeline-board-epic-05 ──────────────────────────────────────────────
  // The fixture title is deliberately a SINGLE whitespace-free token
  // ("epic-tagged-work"): the Then step below locates the coder column by
  // splitting the header and data row on whitespace, and a multi-word slug
  // would inject extra tokens between the id and the role marks, shifting
  // every subsequent index - this scenario tests column placement, not slug
  // wording (pipeline-board-epic-04 already covers slug derivation).
  registry.define(/^a ticket held by the coder$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.epicTicketId = 'BL-6';
    ctx.epicTicketEpic = 'Concerto';
    ctx.fixture.setRoleHeldTickets({ coder: [ctx.epicTicketId] });
    ctx.fixture.setFolders(folders({ active: [{ id: ctx.epicTicketId, title: 'epic-tagged-work', epic: ctx.epicTicketEpic }] }));
  });

  registry.define(/^the ticket is marked in the coder column$/, (ctx) => {
    const { gridLines } = splitBoardSections(lastRendered(ctx.fixture));
    const row = gridLines.find((l) => l.trim().split(/\s+/)[0] === ctx.epicTicketId);
    if (!row) {
      throw new Error(`expected ${ctx.epicTicketId} to be a stage-grid row, got:\n${gridLines.join('\n')}`);
    }
    const header = gridLines[0].trim().split(/\s+/);
    const coderIndex = header.indexOf('CO');
    if (row.trim().split(/\s+/)[coderIndex] !== 'X') {
      throw new Error(`expected ${ctx.epicTicketId}'s row to mark the CO column, got: "${row}"`);
    }
  });

  registry.define(/^the ticket appears under its own epic group$/, (ctx) => {
    const { gridLines } = splitBoardSections(lastRendered(ctx.fixture));
    const headingIndex = gridLines.findIndex((l) => l.trim() === `-- ${ctx.epicTicketEpic} --`);
    if (headingIndex === -1) {
      throw new Error(`expected a "-- ${ctx.epicTicketEpic} --" heading, got:\n${gridLines.join('\n')}`);
    }
    if (gridLines[headingIndex + 1].trim().split(/\s+/)[0] !== ctx.epicTicketId) {
      throw new Error(`expected ${ctx.epicTicketId} directly under its own epic heading, got:\n${gridLines.join('\n')}`);
    }
  });

  // ── pipeline-board-epic-06 ──────────────────────────────────────────────
  // "the pipeline board is rendered and posted" and "no ticket, handoff, or
  // backlog state is modified by the board" reuse bl452PipelineBoardSteps.js's
  // own registrations - the board's read-only claim holds identically
  // whether or not the rows are epic-grouped.
  //
  // Deliberately setRoleHeldTickets only, no setFolders - mirrors
  // bl452PipelineBoardSteps.js's own "no ticket, handoff, or backlog state
  // is modified" fixture exactly (same comment there): populating
  // folders.active with real ticket entries would trigger OTHER, PRE-EXISTING
  // concierge-tick machinery unrelated to the board (per-ticket TaskStarted
  // topic creation, epic-topic creation on a newly-active epic'd ticket -
  // epicsAsFirstClassTopicsSteps.js's own feature) - a real side effect of
  // those other features, not evidence the board itself writes state.
  registry.define(/^active tickets span several epics and stages$/, (ctx) => {
    ctx.fixture = fakeConciergeAdapters();
    ctx.fixture.setRoleHeldTickets({ coder: ['BL-1'], QA: ['BL-2'], architect: ['BL-3'] });
  });
}

module.exports = { registerSteps };
