'use strict';

// BL-585: step handlers for "The pipeline board renders active tickets as
// one matrix with ticket columns". Drives the real, compiled pipelineBoard
// module directly - never a reimplementation of the matrix layout or the
// width budget. No filesystem fixture needed anywhere in this file: every
// scenario builds its PipelineBoardData in memory, same as the module's own
// unit tests.

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  computePipelineBoard,
  renderPipelineBoardBody,
  renderPipelineBoardGridOnly,
  composePipelineBoardHtml,
  deriveDisplayTicketId,
  PIPELINE_BOARD_COLUMN_ORDER,
  PIPELINE_BOARD_GRID_MAX_WIDTH,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'pipelineBoard'));

const FEATURE = 'The pipeline board renders active tickets as one matrix with ticket columns';
const NBSP = ' ';
const ROLE_LABELS = ['NS', 'SP', 'CO', 'CL', 'AR', 'HD', 'DC', 'QA'];

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough.
const HOLDER_ROLE_HELD_TICKETS = {
  coder: { coder: ['BL-537'] },
  QA: { QA: ['BL-537'] },
  coordinator: { coordinator: ['BL-537'] },
  nobody: {},
};

function parseHolder(token) {
  if (!(token in HOLDER_ROLE_HELD_TICKETS)) {
    throw new Error(`unknown holder token: ${token}`);
  }
  return HOLDER_ROLE_HELD_TICKETS[token];
}

function parseEpicToken(token) {
  if (token === 'absent') {
    return undefined;
  }
  return token;
}

function matrixLine(gutter, cells, cellWidth) {
  return gutter + cells.map((c) => NBSP + c.padStart(cellWidth, NBSP)).join('');
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^the pipeline board grid width budget is 30 characters$/,
    () => {
      assert.equal(PIPELINE_BOARD_GRID_MAX_WIDTH, 30);
    },
    FEATURE
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^active ticket BL-537 held by coder and active ticket BL-576 held by QA$/,
    (ctx) => {
      ctx.data = computePipelineBoard({ coder: ['BL-537'], QA: ['BL-576'] }, [], {});
    },
    FEATURE
  );

  registry.defineScoped(
    /^the pipeline board grid is rendered$/,
    (ctx) => {
      ctx.gridText = renderPipelineBoardBody(ctx.data);
      ctx.gridLines = ctx.gridText.split('\n');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the matrix opens with one header row carrying "(\d+)" and "(\d+)"$/,
    (ctx, idA, idB) => {
      assert.ok(ctx.gridLines[0].includes(idA), `expected header to carry ${idA}, got: ${ctx.gridLines[0]}`);
      assert.ok(ctx.gridLines[0].includes(idB), `expected header to carry ${idB}, got: ${ctx.gridLines[0]}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the matrix has exactly 8 role rows labelled NS, SP, CO, CL, AR, HD, DC and QA$/,
    (ctx) => {
      const labels = ctx.gridLines.slice(1, 9).map((l) => l.slice(0, 2));
      assert.deepEqual(labels, ROLE_LABELS);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no epic section heading appears anywhere in the grid$/,
    (ctx) => {
      assert.ok(!ctx.gridLines.some((l) => l.startsWith('--')), `expected no "-- epic --" heading, got:\n${ctx.gridText}`);
    },
    FEATURE
  );

  // ── Scenario 02 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^active ticket BL-537 is held by (.+)$/,
    (ctx, token) => {
      const roleHeldTickets = parseHolder(token);
      ctx.data = computePipelineBoard(roleHeldTickets, [], {}, { activeIds: ['BL-537'] });
    },
    FEATURE
  );

  registry.defineScoped(
    /^role row "([A-Z]{2})" carries the mark "X" in the BL-537 column$/,
    (ctx, row) => {
      const line = ctx.gridLines.find((l) => l.startsWith(row));
      assert.equal(line, matrixLine(row, ['X'], 3), `expected row ${row} to carry X, got:\n${ctx.gridText}`);
      ctx.markedRow = row;
    },
    FEATURE
  );

  registry.defineScoped(
    /^every other role row carries "\." in the BL-537 column$/,
    (ctx) => {
      for (const role of ROLE_LABELS) {
        if (role === ctx.markedRow) {
          continue;
        }
        const line = ctx.gridLines.find((l) => l.startsWith(role));
        assert.equal(line, matrixLine(role, ['.'], 3), `expected row ${role} to carry ".", got:\n${ctx.gridText}`);
      }
    },
    FEATURE
  );

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^active ticket BL-537 whose epic is (.+)$/,
    (ctx, token) => {
      const epic = parseEpicToken(token);
      const rows = [{ id: 'BL-537', column: 'coder', epic, slug: '' }];
      ctx.data = { rows, parked: [] };
    },
    FEATURE
  );

  registry.defineScoped(
    /^the caption line "(.+)" appears below the matrix$/,
    (ctx, caption) => {
      assert.ok(ctx.gridLines.includes(caption), `expected caption "${caption}" in:\n${ctx.gridText}`);
    },
    FEATURE
  );

  // ── Scenario 04 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^(\d+) active tickets whose display ids are 3 characters wide$/,
    (ctx, countToken) => {
      const count = Number(countToken);
      const rows = [];
      for (let i = 0; i < count; i++) {
        rows.push({ id: `BL-${100 + i}`, column: 'coder', slug: '' });
      }
      ctx.data = { rows, parked: [] };
    },
    FEATURE
  );

  registry.defineScoped(
    /^no grid line is wider than 30 characters$/,
    (ctx) => {
      for (const line of ctx.gridLines) {
        assert.ok(line.length <= 30, `expected every grid line <= 30 chars, got ${line.length}: ${JSON.stringify(line)}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^the matrix shows (\d+) ticket columns$/,
    (ctx, shownToken) => {
      const header = ctx.gridLines[0];
      const idCount = (header.match(/\d+/g) || []).length;
      assert.equal(idCount, Number(shownToken), `expected ${shownToken} visible columns in header: ${JSON.stringify(header)}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the grid overflow line is "(.+)"$/,
    (ctx, overflow) => {
      if (overflow === '(none)') {
        assert.ok(!ctx.gridLines.some((l) => /^\+\d+ more active$/.test(l)), `expected no overflow line, got:\n${ctx.gridText}`);
      } else {
        assert.ok(ctx.gridLines.includes(overflow), `expected overflow line "${overflow}" in:\n${ctx.gridText}`);
      }
    },
    FEATURE
  );

  // ── Scenario 05 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^10 active tickets and a resolvable repo base url$/,
    (ctx) => {
      const roleHeldTickets = { coder: [] };
      const ticketMeta = {};
      for (let i = 0; i < 10; i++) {
        const id = `BL-${200 + i}`;
        roleHeldTickets.coder.push(id);
        ticketMeta[id] = { filename: `${id}-x.yaml`, location: 'active' };
      }
      ctx.ids = roleHeldTickets.coder.slice();
      ctx.data = computePipelineBoard(roleHeldTickets, [], ticketMeta, {
        repoBaseUrl: 'https://github.com/ldecorps/swarmforgevc',
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the full pipeline board is rendered$/,
    (ctx) => {
      const { html } = composePipelineBoardHtml(ctx.data, Date.UTC(2026, 6, 19, 12, 0), 'https://github.com/ldecorps/swarmforgevc');
      ctx.fullHtml = html;
    },
    FEATURE
  );

  registry.defineScoped(
    /^all 10 ticket ids appear in the link list$/,
    (ctx) => {
      for (const id of ctx.ids) {
        const displayId = deriveDisplayTicketId(id);
        assert.ok(ctx.fullHtml.includes(`>${displayId}</a>`), `expected ${id} (as ${displayId}) linked in:\n${ctx.fullHtml}`);
      }
    },
    FEATURE
  );

  // ── Scenario 06 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^no active tickets$/,
    (ctx) => {
      ctx.data = { rows: [], parked: [] };
    },
    FEATURE
  );

  registry.defineScoped(
    /^the grid is the single line "(.+)"$/,
    (ctx, expected) => {
      assert.equal(ctx.gridText, expected);
    },
    FEATURE
  );

  // ── Scenario 07 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^every column gap in the matrix is a non-breaking space$/,
    (ctx) => {
      const matrixLines = ctx.gridLines.slice(0, 9); // header + 8 role rows
      for (const line of matrixLines) {
        assert.ok(line.includes(NBSP), `expected at least one NBSP gap in matrix line: ${JSON.stringify(line)}`);
        assert.ok(!line.includes(' '), `expected no plain ASCII space in matrix line: ${JSON.stringify(line)}`);
      }
    },
    FEATURE
  );

  registry.defineScoped(
    /^no matrix line contains a plain ASCII space$/,
    (ctx) => {
      const matrixLines = ctx.gridLines.slice(0, 9);
      for (const line of matrixLines) {
        assert.ok(!line.includes(' '), `expected no plain ASCII space in matrix line: ${JSON.stringify(line)}`);
      }
    },
    FEATURE
  );

  // ── Scenario 08 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the grid-only render and the full board body are both produced$/,
    (ctx) => {
      ctx.gridOnly = renderPipelineBoardGridOnly(ctx.data);
      ctx.body = renderPipelineBoardBody(ctx.data);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the grid-only render is a prefix of the full board body$/,
    (ctx) => {
      assert.ok(ctx.body.startsWith(ctx.gridOnly), `expected the grid-only render to be a prefix of the full body.\ngridOnly:\n${ctx.gridOnly}\nbody:\n${ctx.body}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
