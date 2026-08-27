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

function matrixLine(gutter, cells, cellWidth) {
  return gutter + cells.map((c) => NBSP + c.padStart(cellWidth, NBSP)).join('');
}

// BL-979: one ticket line - the display id right-aligned in the gutter,
// then an X under the held stage and "." under the other seven.
const STAGE_CELL_WIDTH = 2;
function ticketRow(displayId, gutterWidth, heldStage) {
  return matrixLine(
    displayId.padStart(gutterWidth, NBSP),
    ROLE_LABELS.map((r) => (r === heldStage ? 'X' : '.')),
    STAGE_CELL_WIDTH
  );
}

// The matrix runs from the header to the first blank line; the caption
// block below it is prose.
function matrixLinesOf(gridLines) {
  const firstBlank = gridLines.indexOf('');
  return firstBlank === -1 ? gridLines : gridLines.slice(0, firstBlank);
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

  // ── Scenario 02 (Outline) ────────────────────────────────────────────
  registry.defineScoped(
    /^active ticket BL-537 is held by (.+)$/,
    (ctx, token) => {
      const roleHeldTickets = parseHolder(token);
      ctx.data = computePipelineBoard(roleHeldTickets, [], {}, { activeIds: ['BL-537'] });
    },
    FEATURE
  );

  // BL-979: transposed. BL-537 is a ROW now and the stages are the shared
  // COLUMNS, so "the mark for this holder" is read from the ticket's own
  // line at the held stage's column offset. The holder->stage mapping this
  // Outline covers - notably a coordinator-held ticket rendering at QA, and
  // an unheld one at NS - is the part BL-979's own feature file does not
  // re-assert, which is why this scenario was transposed rather than
  // retired with the others.
  registry.defineScoped(
    /^stage column "([A-Z]{2})" carries the mark "X" in the BL-537 row$/,
    (ctx, stage) => {
      assert.equal(ctx.gridLines[1], ticketRow('537', 3, stage), `expected BL-537 marked at ${stage}, got:\n${ctx.gridText}`);
      ctx.markedStage = stage;
    },
    FEATURE
  );

  registry.defineScoped(
    /^every other stage column carries "\." in the BL-537 row$/,
    (ctx) => {
      // Already pinned byte-for-byte by the step above (ticketRow builds the
      // whole line, X in one column and "." in the other seven); this
      // re-states it per stage so a failure names the offending column.
      const cells = ctx.gridLines[1].slice(3).split(NBSP).filter(Boolean);
      ROLE_LABELS.forEach((role, i) => {
        assert.equal(cells[i], role === ctx.markedStage ? 'X' : '.', `stage ${role}`);
      });
    },
    FEATURE
  );

  // ── Scenario 05 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^15 active tickets and a resolvable repo base url$/,
    (ctx) => {
      const roleHeldTickets = { coder: [] };
      const ticketMeta = {};
      for (let i = 0; i < 15; i++) {
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
    /^all 15 ticket ids appear in the link list$/,
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
      // BL-979: the matrix is the header plus one line per visible TICKET,
      // so its height is no longer the fixed 9. Everything up to the first
      // blank line is the matrix; the caption block below it is prose and
      // legitimately contains ASCII spaces.
      const matrixLines = matrixLinesOf(ctx.gridLines);
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
      const matrixLines = matrixLinesOf(ctx.gridLines);
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
