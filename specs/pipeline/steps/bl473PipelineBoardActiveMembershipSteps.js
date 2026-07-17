'use strict';

// BL-473: step handlers for "The pipeline board shows every ticket
// physically in backlog/active/, marking a not-yet-held one as not started
// rather than dropping it". Drives the REAL compiled computePipelineBoard
// (pipelineBoard.ts) through bl465PipelineBoardRenderRound2Steps.js's own
// shared render() - the SAME third ctx shape that file's own scenarios use
// (ctx.roleHeldTickets/ctx.ticketMeta/ctx.activeIds, no ctx.fixture/ctx.root)
// - never a hand-rolled reimplementation of the render rules. "the ticket
// appears on the board at that role's stage" reuses
// bl464PipelineBoardAuthoritativeStageSourceSteps.js's own registration
// (same ctx.board/ctx.ticketId/ctx.role shape that file already reads) -
// this file only adds the NEW not-started assertions BL-473 introduces.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { PIPELINE_BOARD_NOT_STARTED_COLUMN } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

function rowFor(ctx, id) {
  return ctx.board.rows.filter((r) => r.id === id);
}

function registerSteps(registry) {
  // Background - a semantic no-op placeholder (each scenario's own Given
  // below fully arranges its fixture); documents intent rather than
  // asserting anything of its own.
  registry.define(/^the pipeline board is wired$/, () => {});

  // ── board-active-membership-01 ────────────────────────────────────────
  registry.define(/^an active ticket that a role currently holds$/, (ctx) => {
    ctx.ticketId = 'BL-901';
    ctx.role = 'coder';
    ctx.roleHeldTickets = { coder: [ctx.ticketId] };
    ctx.activeIds = [ctx.ticketId];
  });

  // "the ticket appears on the board at that role's stage" is NOT
  // registered here - bl464PipelineBoardAuthoritativeStageSourceSteps.js's
  // own registration (first in index.js order) already reads exactly
  // ctx.board/ctx.ticketId/ctx.role, which this file's Given steps set the
  // same way.

  // ── board-active-membership-02 ────────────────────────────────────────
  registry.define(/^a ticket physically in backlog\/active\/ that no role currently holds$/, (ctx) => {
    ctx.ticketId = 'BL-902';
    ctx.roleHeldTickets = {};
    ctx.activeIds = [ctx.ticketId];
  });

  registry.define(/^the ticket appears on the board in the not-started state$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1 || rows[0].column !== PIPELINE_BOARD_NOT_STARTED_COLUMN) {
      throw new Error(`expected ${ctx.ticketId} on the board in the not-started state, got: ${JSON.stringify(ctx.board.rows)}`);
    }
  });

  // The not-started sentinel is, by construction (buildGridRows in
  // pipelineBoard.ts), mutually exclusive with every real pipeline role
  // column - so this is the same check as the Then step above, registered
  // separately because the feature file states it as its own And clause.
  registry.define(/^it is not marked at any pipeline role stage$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1 || rows[0].column !== PIPELINE_BOARD_NOT_STARTED_COLUMN) {
      throw new Error(`expected ${ctx.ticketId} marked at no pipeline role stage (not-started only), got: ${JSON.stringify(ctx.board.rows)}`);
    }
  });

  // ── board-active-membership-03 ────────────────────────────────────────
  registry.define(/^the tickets physically in backlog\/active\/$/, (ctx) => {
    ctx.activeIds = ['BL-910', 'BL-911'];
    // BL-999 is role-held but deliberately ABSENT from activeIds - proves
    // membership is exactly the physical backlog/active/ set, "and only
    // those": a role-held ticket the coordinator has not (or no longer)
    // recorded as active gets no row at all.
    ctx.roleHeldTickets = { coder: ['BL-910'], cleaner: ['BL-999'] };
    ctx.absentId = 'BL-999';
  });

  registry.define(/^each of those tickets appears on exactly one active row$/, (ctx) => {
    for (const id of ctx.activeIds) {
      const rows = rowFor(ctx, id);
      if (rows.length !== 1) {
        throw new Error(`expected ${id} on exactly one active row, got: ${JSON.stringify(rows)}`);
      }
    }
  });

  registry.define(/^no active row exists for a ticket absent from backlog\/active\/$/, (ctx) => {
    const rows = rowFor(ctx, ctx.absentId);
    if (rows.length !== 0) {
      throw new Error(`expected no active row for ${ctx.absentId} (absent from backlog/active/), got: ${JSON.stringify(rows)}`);
    }
  });

  // ── board-active-membership-04 ────────────────────────────────────────
  registry.define(/^a not-started active ticket$/, (ctx) => {
    ctx.ticketId = 'BL-920';
    ctx.activeIds = [ctx.ticketId];
    ctx.roleHeldTickets = {};
  });

  registry.define(/^a role then begins holding it$/, (ctx) => {
    ctx.role = 'coder';
    ctx.roleHeldTickets = { coder: [ctx.ticketId] };
  });

  registry.define(/^it no longer appears in the not-started state$/, (ctx) => {
    const rows = rowFor(ctx, ctx.ticketId);
    if (rows.length !== 1 || rows[0].column === PIPELINE_BOARD_NOT_STARTED_COLUMN) {
      throw new Error(`expected ${ctx.ticketId} no longer in the not-started state, got: ${JSON.stringify(ctx.board.rows)}`);
    }
  });
}

module.exports = { registerSteps };
