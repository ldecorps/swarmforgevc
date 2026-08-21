'use strict';

// BL-956: step handlers for "Pipeline board caption and cap hotfix".
// Drives the real computePipelineBoard/render/compose pipeline over
// in-memory backlog fixtures - grid layout logic is inside the step-handler
// surface allowlist (see index.js header).

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  computePipelineBoard,
  renderPipelineBoardBody,
  composePipelineBoardHtml,
  deriveDisplayTicketId,
  PIPELINE_BOARD_MESSAGE_MAX_LENGTH,
  PIPELINE_BOARD_GRID_MAX_WIDTH,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'pipelineBoard'));

const FEATURE = 'Pipeline board caption and cap hotfix';

// KNOWN_VALUES per Scenario Outline row - an unknown token throws.
const PARKED_KINDS = {
  'plain-parked': (ctx, count) => {
    for (let i = 0; i < count; i += 1) {
      const id = `BL-${300 + i}`;
      ctx.paused.push({ id, priority: i });
      ctx.ticketMeta[id] = { title: `parked ticket ${i}`, location: 'paused' };
    }
    ctx.kindLinePattern = /^ {2}3\d\d /;
  },
  'epic-tracker': (ctx, count) => {
    for (let i = 0; i < count; i += 1) {
      const id = `BL-${400 + i}`;
      ctx.paused.push({ id, type: 'epic', epic: `epic-${i}`, priority: i });
      ctx.ticketMeta[id] = { title: `epic tracker ${i}`, epic: `epic-${i}`, location: 'paused' };
    }
    ctx.kindLinePattern = /^ {2}epic-\d/;
  },
};

const KNOWN_COUNTS = new Set(['5', '3', '180']);

function requireKnownNumber(token) {
  if (!KNOWN_COUNTS.has(token)) {
    throw new Error(`unknown numeric token: ${token}`);
  }
  return Number(token);
}

function addActive(ctx, id, meta) {
  ctx.activeIds.push(id);
  if (meta) {
    ctx.ticketMeta[id] = { ...meta, location: 'active' };
  }
}

function render(ctx) {
  ctx.data = computePipelineBoard(ctx.roleHeld, ctx.paused, ctx.ticketMeta, { activeIds: ctx.activeIds });
  ctx.body = renderPipelineBoardBody(ctx.data);
  ctx.lines = ctx.body.split('\n');
}

function captionLineFor(ctx, id) {
  const displayId = deriveDisplayTicketId(id);
  return ctx.lines.find((l) => l.startsWith(`${displayId} `) || l === displayId);
}

// Independent restatement of the grid's documented width budget: 2-char
// gutter + per visible column one separator + one cell of the widest
// display id (min 3).
function visibleRowIds(ctx) {
  const ids = ctx.data.rows.map((r) => r.id);
  const cellWidth = Math.max(3, ...ids.map((id) => deriveDisplayTicketId(id).length));
  const visible = Math.max(0, Math.min(ids.length, Math.floor((PIPELINE_BOARD_GRID_MAX_WIDTH - 2) / (1 + cellWidth))));
  return ids.slice(0, visible);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a pipeline board rendered from the backlog folders and the role-held tickets$/,
    (ctx) => {
      ctx.roleHeld = {};
      ctx.paused = [];
      ctx.ticketMeta = {};
      ctx.activeIds = [];
    },
    FEATURE
  );

  // ── Givens ───────────────────────────────────────────────────────────
  registry.defineScoped(
    /^active ticket "([^"]+)" holds epic "([^"]+)" and title "([^"]+)"$/,
    (ctx, id, epic, title) => {
      addActive(ctx, id, { epic, title });
    },
    FEATURE
  );

  registry.defineScoped(
    /^role "([^"]+)" holds ticket "([^"]+)" and no backlog entry exists for it$/,
    (ctx, role, id) => {
      ctx.roleHeld[role] = [...(ctx.roleHeld[role] ?? []), id];
      ctx.activeIds.push(id);
    },
    FEATURE
  );

  registry.defineScoped(
    /^active tickets "([^"]+)" and "([^"]+)" hold epic "([^"]+)" and active ticket "([^"]+)" holds epic "([^"]+)"$/,
    (ctx, idA, idB, epicAB, idC, epicC) => {
      addActive(ctx, idA, { epic: epicAB, title: `work on ${idA}` });
      addActive(ctx, idB, { epic: epicAB, title: `work on ${idB}` });
      addActive(ctx, idC, { epic: epicC, title: `work on ${idC}` });
    },
    FEATURE
  );

  registry.defineScoped(
    /^"(\d+)" parked tickets of kind "([^"]+)" awaiting the board$/,
    (ctx, countToken, kind) => {
      const apply = PARKED_KINDS[kind];
      if (!apply) throw new Error(`unknown <kind> token: ${kind}`);
      apply(ctx, requireKnownNumber(countToken));
    },
    FEATURE
  );

  registry.defineScoped(
    /^every active ticket carries a title of "(\d+)" characters$/,
    (ctx, lengthToken) => {
      const length = requireKnownNumber(lengthToken);
      for (let i = 0; i < 8; i += 1) {
        const id = `BL-${100 + i}`;
        addActive(ctx, id, {
          epic: 'concerto',
          title: `ticket ${id} `.padEnd(length, 'x'),
          filename: `${id}-x.yaml`,
        });
      }
    },
    FEATURE
  );

  // ── Whens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the board is rendered$/,
    (ctx) => {
      render(ctx);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the board is composed for sending$/,
    (ctx) => {
      render(ctx);
      ctx.composed = composePipelineBoardHtml(ctx.data, 0, 'https://github.com/x/y');
    },
    FEATURE
  );

  // ── Thens ────────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the caption line for "([^"]+)" reads "([^"]+)"$/,
    (ctx, id, expected) => {
      assert.equal(captionLineFor(ctx, id), expected);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no caption line reads "([^"]+)"$/,
    (ctx, forbidden) => {
      assert.ok(!ctx.lines.includes(forbidden), `found forbidden caption ${JSON.stringify(forbidden)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the caption line for "([^"]+)" carries text after the ticket id$/,
    (ctx, id) => {
      const caption = captionLineFor(ctx, id);
      assert.ok(caption, `no caption line for ${id}:\n${ctx.body}`);
      const context = caption.slice(deriveDisplayTicketId(id).length).trim();
      assert.ok(context.length > 0, `caption carries nothing after the id: ${JSON.stringify(caption)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the caption lines for "([^"]+)" and "([^"]+)" are adjacent$/,
    (ctx, idA, idB) => {
      const iA = ctx.lines.indexOf(captionLineFor(ctx, idA));
      const iB = ctx.lines.indexOf(captionLineFor(ctx, idB));
      assert.equal(iB, iA + 1, `expected adjacent captions, got lines ${iA} and ${iB}:\n${ctx.body}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a blank line separates the caption lines for "([^"]+)" and "([^"]+)"$/,
    (ctx, idA, idB) => {
      const iA = ctx.lines.indexOf(captionLineFor(ctx, idA));
      const iB = ctx.lines.indexOf(captionLineFor(ctx, idB));
      assert.equal(iB, iA + 2, `expected exactly one line between captions:\n${ctx.body}`);
      assert.equal(ctx.lines[iA + 1], '', 'the separating line must be blank');
    },
    FEATURE
  );

  registry.defineScoped(
    /^"(\d+)" entries of kind "([^"]+)" are listed$/,
    (ctx, countToken, kind) => {
      if (!PARKED_KINDS[kind]) throw new Error(`unknown <kind> token: ${kind}`);
      const expected = requireKnownNumber(countToken);
      const listed = ctx.lines.filter((l) => ctx.kindLinePattern.test(l));
      assert.equal(listed.length, expected, `expected ${expected} listed ${kind} entries:\n${ctx.body}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^a line reads "([^"]+)"$/,
    (ctx, expected) => {
      assert.ok(
        ctx.lines.some((l) => l.trim() === expected),
        `no line reads ${JSON.stringify(expected)}:\n${ctx.body}`
      );
      // hardener bounce D1: the plain-text body is only the change-detection
      // content signature - the LIVE HTML message must carry the cap line too
      const { html } = composePipelineBoardHtml(ctx.data, 0, 'https://github.com/x/y');
      assert.ok(html.includes(expected), `the live HTML lacks ${JSON.stringify(expected)}:\n${html}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the composed message is within the board message length limit$/,
    (ctx) => {
      assert.ok(
        ctx.composed.html.length <= PIPELINE_BOARD_MESSAGE_MAX_LENGTH,
        `composed ${ctx.composed.html.length} chars > ${PIPELINE_BOARD_MESSAGE_MAX_LENGTH}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^every visible ticket is still identified on the board$/,
    (ctx) => {
      const ids = visibleRowIds(ctx);
      assert.ok(ids.length > 0, 'expected at least one visible row');
      for (const id of ids) {
        const caption = captionLineFor(ctx, id);
        assert.ok(caption, `no caption for visible ticket ${id}:\n${ctx.body}`);
        const context = caption.slice(deriveDisplayTicketId(id).length).trim();
        assert.ok(context.length > 0, `visible ticket ${id} not identified: ${JSON.stringify(caption)}`);
      }
    },
    FEATURE
  );
}

module.exports = { registerSteps };
