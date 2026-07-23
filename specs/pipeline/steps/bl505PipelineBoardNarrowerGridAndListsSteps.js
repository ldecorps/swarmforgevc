'use strict';

// BL-505: step handlers for "the pipeline board grid renders compactly and
// orders its columns for a phone". Drives the REAL compiled
// computePipelineBoard/renderPipelineBoard (pipelineBoard.ts) via the
// SHARED "the pipeline board is rendered" step already registered by
// bl452PipelineBoardSteps.js - that step dispatches to bl465's own
// render(ctx) (computePipelineBoard + renderPipelineBoard over ctx's plain
// roleHeldTickets/paused/ticketMeta/rootIntake/activeIds fields) whenever
// ctx.fixture and ctx.root are both undefined, which is exactly the shape
// this file's own Given steps build - never a hand-rolled reimplementation
// of the render rules, mirroring bl465PipelineBoardRenderRound2Steps.js's
// own convention for this exact module.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { deriveDisplayTicketId } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

function firstToken(line) {
  return line.trim().split(/\s+/)[0];
}

function findLineById(gridText, id) {
  return gridText.split('\n').find((l) => firstToken(l) === id);
}

function registerSteps(registry) {
  // ── narrower-grid-and-lists-01 (Scenario Outline) ───────────────────────
  registry.define(/^a grid row for ticket "([^"]+)"$/, (ctx, id) => {
    ctx.roleHeldTickets = { coder: [id] };
  });

  registry.define(/^the ticket column for that row shows "([^"]+)"$/, (ctx, displayed) => {
    const line = findLineById(ctx.gridText, displayed);
    if (!line) {
      throw new Error(`expected a grid row displaying ticket id "${displayed}", got:\n${ctx.gridText}`);
    }
  });

  // ── narrower-grid-and-lists-02 (Scenario Outline) ───────────────────────
  registry.define(/^a grid row whose ticket title is "([^"]+)"$/, (ctx, title) => {
    ctx.roleHeldTickets = { coder: ['BL-1'] };
    ctx.ticketMeta = { 'BL-1': { title } };
  });

  registry.define(/^the slug column for that row shows "([^"]+)"$/, (ctx, slug) => {
    const row = ctx.board.rows.find((r) => r.id === 'BL-1');
    if (!row || row.slug !== slug) {
      throw new Error(`expected the grid row's slug to be "${slug}", got: ${JSON.stringify(row)}`);
    }
  });

  // ── narrower-grid-and-lists-03 ───────────────────────────────────────────
  registry.define(/^grid rows for tickets "([^"]+)" and "([^"]+)"$/, (ctx, id1, id2) => {
    ctx.roleHeldTickets = { coder: [id1], QA: [id2] };
  });

  registry.define(/^the ticket column is (\d+) characters wide$/, (ctx, width) => {
    const expectedWidth = Number(width);
    const idLines = ctx.gridText.split('\n').filter((l) => /^\d+$/.test(l.trim()));
    if (idLines.length === 0) {
      throw new Error(`expected at least one ticket id line, got:\n${ctx.gridText}`);
    }
    for (const line of idLines) {
      if (line.trim().length > expectedWidth) {
        throw new Error(`expected ticket id line no wider than ${expectedWidth} chars, got "${line.trim()}"`);
      }
    }
  });

  // ── narrower-grid-and-lists-04 ────────────────────────────────────────────
  registry.define(/^a parked ticket "([^"]+)" titled "([^"]+)"$/, (ctx, id, title) => {
    ctx.paused = [{ id }];
    ctx.ticketMeta = { [id]: { title } };
    ctx.expectId = id;
  });

  registry.define(/^the parked entry for that ticket shows id "([^"]+)" and slug "([^"]+)"$/, (ctx, id, slug) => {
    const line = findLineById(ctx.gridText, id);
    if (!line) {
      throw new Error(`expected a parked entry with id "${id}", got:\n${ctx.gridText}`);
    }
    ctx.parkedLine = line;
    const rest = line.trim().split(/\s+/).slice(1).join(' ');
    if (rest !== slug) {
      throw new Error(`expected the parked entry's slug to be "${slug}", got "${rest}"`);
    }
  });

  registry.define(/^the parked entry does not include any further words of the title$/, (ctx) => {
    const tokens = ctx.parkedLine.trim().split(/\s+/);
    if (tokens.length !== 2) {
      throw new Error(`expected exactly "<id> <slug>" (2 tokens), got: "${ctx.parkedLine.trim()}"`);
    }
  });

  // ── narrower-grid-and-lists-05 ────────────────────────────────────────────
  registry.define(/^a root-intake entry "([^"]+)" titled "([^"]+)"$/, (ctx, id, title) => {
    ctx.rootIntake = [{ id, title, filename: `${id}.md` }];
  });

  registry.define(/^the root intake entry's id is shown unchanged as "([^"]+)"$/, (ctx, id) => {
    const line = findLineById(ctx.gridText, id);
    if (!line) {
      throw new Error(`expected a root-intake entry with unchanged id "${id}", got:\n${ctx.gridText}`);
    }
  });

  // ── narrower-grid-and-lists-06 ────────────────────────────────────────────
  registry.define(/^a grid row for a not-started ticket "([^"]+)"$/, (ctx, id) => {
    // A non-empty title (-> non-empty slug) guarantees the slug cell
    // survives whitespace-split parsing as its own token, so the header's
    // and the row's positional column indices stay aligned - an empty slug
    // collapses into the surrounding padding (engineering.prompt's own
    // "a non-empty slug guarantees the slug cell survives whitespace-split
    // parsing" convention, mirrored from pipelineBoard.test.js).
    ctx.activeIds = [id];
    ctx.roleHeldTickets = {};
    ctx.ticketMeta = { [id]: { title: 'not started ticket' } };
    ctx.rowId = id;
  });

  registry.define(/^the "([^"]+)" column is the first stage column, before "([^"]+)"$/, (ctx, first, second) => {
    const lines = ctx.gridText.split('\n');
    const displayed = deriveDisplayTicketId(ctx.rowId);
    const ticketIndex = lines.findIndex((l) => l.trim() === displayed);
    const firstIndex = lines.findIndex((l) => l.startsWith(`${first} `));
    const secondIndex = lines.findIndex((l) => l.startsWith(`${second} `));
    if (ticketIndex < 0 || firstIndex < 0 || secondIndex < 0 || !(ticketIndex < firstIndex && firstIndex < secondIndex)) {
      throw new Error(`expected "${first}" before "${second}" after ticket id in the pivoted block, got:\n${ctx.gridText}`);
    }
  });

  registry.define(/^the not-started ticket's mark falls in that first stage column$/, (ctx) => {
    const lines = ctx.gridText.split('\n');
    const displayed = deriveDisplayTicketId(ctx.rowId);
    const ticketIndex = lines.findIndex((l) => l.trim() === displayed);
    if (ticketIndex < 0) {
      throw new Error(`expected a not-started block for "${displayed}", got:\n${ctx.gridText}`);
    }
    const nsLine = lines.find((l) => l.startsWith('NS '));
    if (nsLine?.trim() !== 'NS X') {
      throw new Error(`expected the not-started ticket marked on the NS line, got: ${nsLine ?? '(missing)'}`);
    }
  });
}

module.exports = { registerSteps };
