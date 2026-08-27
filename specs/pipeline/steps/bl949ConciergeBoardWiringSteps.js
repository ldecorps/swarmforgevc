'use strict';

// BL-949: step handlers for "The board the concierge posts carries each
// active ticket's backlog context and holding stage". Drives the REAL
// compiled runConciergeTick (extension/out/concierge/conciergeTick) with
// fakes only at the transport edges (postMessage/topic adapters) - the
// same posture as conciergeTick.test.js's own fixtures, never a
// reimplementation of the tick or the board. Assertions normalise NBSP
// away and never pin padding, caption field choice, column ordering or
// stage-row count - those are pipelineBoard's own contract, gated by
// BL-585's suites (this feature file's own header note).

const assert = require('node:assert/strict');
const { runConciergeTick } = require('../../../extension/out/concierge/conciergeTick');

const FEATURE =
  "The board the concierge posts carries each active ticket's backlog context and holding stage";

const HOLDER_VALUES = {
  'no role': {},
  'the coder': { coder: ['BL-1'] },
  QA: { QA: ['BL-1'] },
};

const ROW_VALUES = new Set(['NS', 'CO', 'QA']);

function knownHolder(token) {
  if (!Object.prototype.hasOwnProperty.call(HOLDER_VALUES, token)) {
    throw new Error(`unknown <holder> token: ${token}`);
  }
  return HOLDER_VALUES[token];
}

function knownRow(token) {
  if (!ROW_VALUES.has(token)) {
    throw new Error(`unknown <row> token: ${token}`);
  }
  return token;
}

function emptyFolders() {
  return { active: [], paused: [], hold: [], done: [] };
}

function buildAdapters(ctx) {
  const state = { snapshot: null, emittedKeys: [] };
  ctx.posted = [];
  return {
    readFolders: () => ctx.folders,
    readGates: () => [],
    readRoleTicket: () => ({}),
    readTickState: () => state,
    writeTickState: (next) => Object.assign(state, next),
    readRoleHeldTickets: () => ctx.roleHeld,
    // The full routeAdapters stub set from conciergeTick.test.js's own
    // fakeAdapters - the tick's ticket-topic routing runs unconditionally
    // before the board sync, so it needs its whole adapter surface even
    // though these scenarios only ever assert on the board post.
    routeAdapters: {
      getTopicMap: () => ({}),
      createTopic: async () => ({ success: true, topicId: 800 }),
      recordTopicId: () => {},
      sendMessage: async () => true,
      closeTopic: async () => true,
      recordMessage: () => {},
      ensureOperatorTopic: async () => 700,
      ensureApprovalsTopic: async () => 750,
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
    readRoleTopics: () => [],
    boardAdapters: {
      ensureBoardTopic: async () => ({ topicId: 900 }),
      postMessage: async (topicId, text) => {
        ctx.posted.push(text);
        return { messageId: 1 };
      },
      deleteMessage: async () => ({ success: true }),
    },
  };
}

const norm = (l) => l.replace(/ /g, ' ').trim().replace(/ {2,}/g, ' ');

function boardLines(ctx) {
  assert.equal(ctx.posted.length, 1, 'expected exactly one posted board');
  return ctx.posted[0].split('\n').map(norm);
}

function stageRows(lines) {
  return lines.filter((l) => /^[A-Z]{2}( [.X])+$/.test(l));
}

// The caption line for a ticket: starts with its display id, is not the
// header (index 0), and is not a stage row.
function captionLineFor(lines, displayId) {
  return lines.find((l, i) => i > 0 && l.startsWith(`${displayId} `) && !/^[A-Z]{2} /.test(l));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the concierge tick renders the pipeline board from the backlog folders and the roles' held tickets$/,
    (ctx) => {
      ctx.folders = emptyFolders();
      ctx.roleHeld = {};
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^active ticket "([^"]+)" carries the epic "([^"]+)" in the backlog folders$/,
    (ctx, id, epic) => {
      ctx.folders.active.push({ id, title: 'fix the pipeline board', epic });
      ctx.epic = epic;
      ctx.title = 'fix the pipeline board';
    },
    FEATURE
  );

  registry.defineScoped(
    /^active ticket "([^"]+)" carries neither an epic nor a title in the backlog folders$/,
    (ctx, id) => {
      ctx.folders.active.push({ id });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the coder holds "([^"]+)"$/,
    (ctx, id) => {
      ctx.roleHeld = { coder: [id] };
    },
    FEATURE
  );

  registry.defineScoped(
    /^active ticket "([^"]+)" is held by (.+)$/,
    (ctx, id, holder) => {
      ctx.folders.active.push({ id, title: 'fix the pipeline board' });
      ctx.roleHeld = knownHolder(holder);
    },
    FEATURE
  );

  // ── When ─────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the concierge tick posts the pipeline board$/,
    async (ctx) => {
      await runConciergeTick(buildAdapters(ctx));
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the posted board carries a caption line for ticket "([^"]+)" naming its backlog context$/,
    (ctx, displayId) => {
      const lines = boardLines(ctx);
      const caption = captionLineFor(lines, displayId);
      assert.ok(caption, `expected a caption line for ticket ${displayId}, got:\n${ctx.posted[0]}`);
      assert.ok(
        caption.includes(ctx.epic) || caption.includes(ctx.title),
        `expected the caption to name the ticket's backlog epic/title, got: ${caption}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the posted board's caption line for ticket "([^"]+)" names no backlog context$/,
    (ctx, displayId) => {
      const lines = boardLines(ctx);
      const caption = captionLineFor(lines, displayId);
      // The join being load-bearing means: with nothing in the folders to
      // join, the caption cannot invent context - whatever placeholder the
      // caption contract renders, it never carries an epic or title the
      // backlog does not hold. (The placeholder's own wording is
      // pipelineBoard's contract, not asserted.)
      if (caption) {
        assert.ok(
          !caption.includes('Concerto') && !caption.includes('fix the pipeline board'),
          `expected no invented backlog context, got: ${caption}`
        );
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^ticket "([^"]+)" is marked on the "([^"]+)" row of the matrix$/,
    (ctx, displayId, rowToken) => {
      const row = knownRow(rowToken);
      const lines = boardLines(ctx);
      assert.ok(
        lines[0].split(' ').includes(displayId),
        `expected the matrix header to carry ticket ${displayId}, got:\n${ctx.posted[0]}`
      );
      const target = stageRows(lines).find((l) => l.startsWith(`${row} `));
      assert.ok(target, `expected a ${row} stage row, got:\n${ctx.posted[0]}`);
      assert.ok(target.includes('X'), `expected a mark on the ${row} row, got: ${target}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^every other stage row leaves ticket "([^"]+)" unmarked$/,
    (ctx, _displayId) => {
      const lines = boardLines(ctx);
      const rows = stageRows(lines);
      const marked = rows.filter((l) => l.includes('X'));
      assert.equal(
        marked.length,
        1,
        `expected exactly one marked stage row for a single-ticket board, got:\n${ctx.posted[0]}`
      );
    },
    FEATURE
  );
}

module.exports = { registerSteps };
