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
// already locates columns by glyph in the pivoted vertical grid.
const COORDINATOR_GLYPH = 'CD';
const FORWARD_STAGE_GLYPHS = ['SP', 'CO', 'CL', 'AR', 'HD', 'DC', 'QA'];
const NOT_STARTED_GLYPH = 'NS';

function stageGlyphs(gridText) {
  return gridText
    .split('\n')
    .filter((l) => /^[A-Z]{2} [X.]$/.test(l.trim()))
    .map((l) => l.trim().split(/\s+/)[0]);
}

function registerSteps(registry) {
  // ── board-drop-coordinator-03 ──────────────────────────────────────────
  registry.define(/^an active ticket the coordinator currently holds$/, (ctx) => {
    ctx.ticketId = 'BL-950';
    ctx.roleHeldTickets = { coordinator: [ctx.ticketId] };
    ctx.activeIds = [ctx.ticketId];
    ctx.ticketMeta = { [ctx.ticketId]: { title: 'coordinator held ticket' } };
  });

  // ── board-drop-coordinator-01/03 ───────────────────────────────────────
  registry.define(/^the board grid has no coordinator column$/, (ctx) => {
    const glyphs = stageGlyphs(ctx.gridText);
    if (glyphs.includes(COORDINATOR_GLYPH)) {
      throw new Error(`expected no coordinator ("${COORDINATOR_GLYPH}") stage line, got: ${glyphs.join(' ')}`);
    }
  });

  // ── board-drop-coordinator-02 ───────────────────────────────────────────
  registry.define(/^the board grid has a column for every forward pipeline stage from specifier to QA$/, (ctx) => {
    const glyphs = stageGlyphs(ctx.gridText);
    for (const glyph of FORWARD_STAGE_GLYPHS) {
      if (!glyphs.includes(glyph)) {
        throw new Error(`expected a "${glyph}" stage line, got: ${glyphs.join(' ')}`);
      }
    }
  });

  registry.define(/^the board grid has a not-started column$/, (ctx) => {
    const glyphs = stageGlyphs(ctx.gridText);
    if (!glyphs.includes(NOT_STARTED_GLYPH)) {
      throw new Error(`expected a "${NOT_STARTED_GLYPH}" stage line, got: ${glyphs.join(' ')}`);
    }
  });

  // ── board-drop-coordinator-03 ───────────────────────────────────────────
  registry.define(/^the ticket is marked only in the QA column$/, (ctx) => {
    const lines = ctx.gridText.split('\n');
    const displayed = deriveDisplayTicketId(ctx.ticketId);
    const ticketIndex = lines.findIndex((l) => l.trim() === displayed);
    if (ticketIndex < 0) {
      throw new Error(`expected a grid block for "${displayed}", got:\n${ctx.gridText}`);
    }
    const block = lines.slice(ticketIndex, ticketIndex + 9);
    if (block.find((l) => l.trim() === 'QA X') === undefined) {
      throw new Error(`expected ${displayed} marked at QA, got block:\n${block.join('\n')}`);
    }
    for (const glyph of [...FORWARD_STAGE_GLYPHS, NOT_STARTED_GLYPH].filter((g) => g !== 'QA')) {
      const line = block.find((l) => l.startsWith(`${glyph} `));
      if (line?.trim() !== `${glyph} .`) {
        throw new Error(`expected ${displayed} unmarked at ${glyph}, got block:\n${block.join('\n')}`);
      }
    }
  });
}

module.exports = { registerSteps };
