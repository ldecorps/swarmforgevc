'use strict';

// BL-507: step handlers for "the pipeline board grid drops the Coordinator
// column; a coordinator-held ticket is marked at the QA stage instead".
// Drives the REAL compiled computePipelineBoard/renderPipelineBoard
// (pipelineBoard.ts) via the SHARED "the pipeline board is rendered" step
// already registered by bl452PipelineBoardSteps.js - that step dispatches
// to bl465's own render(ctx) whenever ctx.fixture and ctx.root are both
// undefined, which is exactly the shape this file's own Given step (and the
// no-Given scenarios, whose ctx is untouched beyond the no-op Background)
// build - never a hand-rolled reimplementation of the render rules, same
// convention as bl473/bl505's own step files for this exact module.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { deriveDisplayTicketId } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

// Header glyphs are a fixed build-time constant (pipelineBoard.ts's own
// COLUMN_LABEL, not exported) - hardcoded here the same way the unit suite
// and bl452/bl505's own step handlers already locate columns by glyph
// (e.g. indexOf('CO'), indexOf('NS')), never re-derived at test time.
const COORDINATOR_GLYPH = 'CD';
const FORWARD_STAGE_GLYPHS = ['SP', 'CO', 'CL', 'AR', 'HD', 'DC', 'QA'];
const NOT_STARTED_GLYPH = 'NS';

function headerCells(ctx) {
  return ctx.gridText.split('\n')[0].trim().split(/\s+/);
}

function registerSteps(registry) {
  // ── board-drop-coordinator-03 ──────────────────────────────────────────
  registry.define(/^an active ticket the coordinator currently holds$/, (ctx) => {
    ctx.ticketId = 'BL-950';
    ctx.roleHeldTickets = { coordinator: [ctx.ticketId] };
    ctx.activeIds = [ctx.ticketId];
    // A non-empty title (-> non-empty slug) guarantees the slug cell
    // survives whitespace-split parsing below as its own token (same
    // convention as bl505PipelineBoardNarrowerGridAndListsSteps.js's own
    // not-started-ticket Given).
    ctx.ticketMeta = { [ctx.ticketId]: { title: 'coordinator held ticket' } };
  });

  // ── board-drop-coordinator-01/03 ───────────────────────────────────────
  registry.define(/^the board grid has no coordinator column$/, (ctx) => {
    const header = headerCells(ctx);
    if (header.includes(COORDINATOR_GLYPH)) {
      throw new Error(`expected no coordinator ("${COORDINATOR_GLYPH}") column in the header, got: ${header.join(' ')}`);
    }
  });

  // ── board-drop-coordinator-02 ───────────────────────────────────────────
  registry.define(/^the board grid has a column for every forward pipeline stage from specifier to QA$/, (ctx) => {
    const header = headerCells(ctx);
    for (const glyph of FORWARD_STAGE_GLYPHS) {
      if (!header.includes(glyph)) {
        throw new Error(`expected a "${glyph}" column in the header, got: ${header.join(' ')}`);
      }
    }
  });

  registry.define(/^the board grid has a not-started column$/, (ctx) => {
    const header = headerCells(ctx);
    if (!header.includes(NOT_STARTED_GLYPH)) {
      throw new Error(`expected a "${NOT_STARTED_GLYPH}" column in the header, got: ${header.join(' ')}`);
    }
  });

  // ── board-drop-coordinator-03 ───────────────────────────────────────────
  registry.define(/^the ticket is marked only in the QA column$/, (ctx) => {
    const lines = ctx.gridText.split('\n');
    const header = headerCells(ctx);
    const displayed = deriveDisplayTicketId(ctx.ticketId);
    const rowLine = lines.find((l) => l.trim().split(/\s+/)[0] === displayed);
    if (!rowLine) {
      throw new Error(`expected a grid row for "${displayed}", got:\n${ctx.gridText}`);
    }
    const headerCols = header.slice(2); // drop ID, SLUG
    const rowCols = rowLine.trim().split(/\s+/).slice(2); // drop id, slug
    const qaIndex = headerCols.indexOf('QA');
    if (qaIndex < 0) {
      throw new Error(`expected a "QA" column in the header, got: ${header.join(' ')}`);
    }
    rowCols.forEach((cell, i) => {
      const expected = i === qaIndex ? 'X' : '.';
      if (cell !== expected) {
        throw new Error(`expected ${displayed} marked only in the QA column, got row: ${rowLine}`);
      }
    });
  });
}

module.exports = { registerSteps };
