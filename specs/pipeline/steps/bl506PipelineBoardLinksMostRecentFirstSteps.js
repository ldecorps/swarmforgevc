'use strict';

// BL-506: step handlers for "the pipeline board LINKS section lists the
// most recent tickets first". Drives the REAL compiled computePipelineBoard
// (pipelineBoard.ts) against fixture data - never a hand-rolled
// reimplementation of the ordering rule, mirroring bl465/bl502's own
// "drive the real compiled board" convention. The Background step ("a repo
// base url is configured...") is already registered by
// bl502PipelineBoardMessageLengthBudgetSteps.js - reused verbatim, not
// redefined here.
//
// BL-513: "the pipeline board links are rendered" and "the links appear in
// the order (.+)" are VERBATIM identical to this file's own step text
// below, so this file's registration (first in index.js order) owns both
// texts for BL-513's own scenarios too (BL-464's "identical text, first-
// registered wins" convention) - extended, never forked, to also thread
// ctx.paused/ctx.recentlyClosed through to computePipelineBoard (both
// default to their pre-BL-513 empty value, so every existing BL-506
// scenario - which never sets either - renders identically).
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { computePipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

// Extracts every double-quoted substring in order, e.g.
// `"BL-101", "BL-493", "BL-504"` -> ['BL-101', 'BL-493', 'BL-504'].
function quotedList(text) {
  const ids = [];
  const pattern = /"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(text))) {
    ids.push(match[1]);
  }
  return ids;
}

function registerSteps(registry) {
  // ── pipeline-board-links-most-recent-first-03 (specific: registered
  // BEFORE the generic list pattern below, since its text also starts with
  // "linkable tickets " and would otherwise match the generic pattern
  // first - resolve() is first-match, not most-specific-match) ───────────
  registry.define(/^linkable tickets "([^"]+)" and a root-intake entry "([^"]+)"$/, (ctx, ticketId, intakeId) => {
    ctx.roleHeldTickets = { coder: [ticketId] };
    ctx.ticketMeta = { [ticketId]: { filename: `${ticketId}-a-fine-ticket.yaml`, location: 'active' } };
    ctx.rootIntake = [{ id: intakeId, title: 'a raw ask', filename: `${intakeId}.md` }];
  });

  // ── pipeline-board-links-most-recent-first-01/02 ────────────────────────
  registry.define(/^linkable tickets (.+)$/, (ctx, rest) => {
    const ids = quotedList(rest);
    ctx.roleHeldTickets = { coder: ids };
    ctx.ticketMeta = {};
    for (const id of ids) {
      ctx.ticketMeta[id] = { filename: `${id}-a-fine-ticket.yaml`, location: 'active' };
    }
  });

  registry.define(/^the pipeline board links are rendered$/, (ctx) => {
    ctx.board = computePipelineBoard(ctx.roleHeldTickets ?? {}, ctx.paused ?? [], ctx.ticketMeta ?? {}, {
      rootIntake: ctx.rootIntake ?? [],
      recentlyClosed: ctx.recentlyClosed ?? [],
      repoBaseUrl: ctx.repoBaseUrl,
    });
  });

  registry.define(/^the links appear in the order (.+)$/, (ctx, rest) => {
    const expected = quotedList(rest);
    const actual = ctx.board.links.map((l) => l.id);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`expected links in order ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  });
}

module.exports = { registerSteps };
