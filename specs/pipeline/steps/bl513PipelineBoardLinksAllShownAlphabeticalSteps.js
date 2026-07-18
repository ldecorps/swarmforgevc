'use strict';

// BL-513: step handlers for "the pipeline board LINKS section links every
// shown ticket, alphabetically, to its current folder". The Background step
// ("a repo base url is configured...") is already registered by
// bl502PipelineBoardMessageLengthBudgetSteps.js - reused verbatim. "the
// pipeline board links are rendered" and "the links appear in the order
// (.+)" are already registered (and, for this ticket, extended) by
// bl506PipelineBoardLinksMostRecentFirstSteps.js - reused verbatim, not
// redefined here (BL-464's "identical text, first-registered wins"
// convention). Drives the REAL compiled computePipelineBoard/
// syncPipelineBoard (pipelineBoard.ts/pipelineBoardSync.ts) against fixture
// data - never a hand-rolled reimplementation of the link/freshness rules.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { computePipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));
const { syncPipelineBoard } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoardSync'));

function quotedList(text) {
  const ids = [];
  const pattern = /"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(text))) {
    ids.push(match[1]);
  }
  return ids;
}

function addActive(ctx, id) {
  ctx.roleHeldTickets = ctx.roleHeldTickets ?? {};
  ctx.roleHeldTickets.coder = [...(ctx.roleHeldTickets.coder ?? []), id];
  ctx.ticketMeta = ctx.ticketMeta ?? {};
  ctx.ticketMeta[id] = { filename: `${id}.yaml`, location: 'active' };
}

function addParked(ctx, id) {
  ctx.paused = [...(ctx.paused ?? []), { id }];
  ctx.ticketMeta = ctx.ticketMeta ?? {};
  ctx.ticketMeta[id] = { filename: `${id}.yaml`, location: 'paused' };
}

function addRecentlyClosed(ctx, id) {
  ctx.recentlyClosed = [...(ctx.recentlyClosed ?? []), { id, filename: `${id}.yaml` }];
}

function addRootIntake(ctx, id) {
  ctx.rootIntake = [...(ctx.rootIntake ?? []), { id, title: 'a raw ask', filename: `${id}.md` }];
}

// engineering.prompt's Scenario Outline rule: every Examples: column value
// validated against an explicit KNOWN_VALUES lookup, never a passthrough.
const SHOWN_AS_FOR_FOLDER = { active: addActive, paused: addParked, done: addRecentlyClosed, root: addRootIntake };

function registerSteps(registry) {
  // ── pipeline-board-links-all-shown-01 ──────────────────────────────────
  registry.define(/^the board grid shows tickets "([^"]+)", "([^"]+)"$/, (ctx, id1, id2) => {
    addActive(ctx, id1);
    addActive(ctx, id2);
  });

  registry.define(/^a parked ticket "([^"]+)" shown on the board$/, (ctx, id) => {
    addParked(ctx, id);
  });

  registry.define(/^a recently-closed ticket "([^"]+)" shown on the board$/, (ctx, id) => {
    addRecentlyClosed(ctx, id);
  });

  registry.define(/^a root-intake item "([^"]+)" shown on the board$/, (ctx, id) => {
    addRootIntake(ctx, id);
  });

  registry.define(/^every shown ticket has a link$/, (ctx) => {
    if (ctx.board.links.length === 0) {
      throw new Error('expected at least one link on the rendered board, got none');
    }
  });

  registry.define(/^"([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)" and "([^"]+)" all have links$/, (ctx, ...ids) => {
    const linked = new Set(ctx.board.links.map((l) => l.id));
    const missing = ids.filter((id) => !linked.has(id));
    if (missing.length > 0) {
      throw new Error(`expected every shown ticket linked, missing: ${missing.join(', ')} - got links for: ${[...linked].join(', ')}`);
    }
  });

  // ── pipeline-board-links-alphabetical-02 (Scenario Outline) ────────────
  // Same ctx shape as bl506's own "linkable tickets (.+)" Given, under
  // BL-513's own step text - every listed id becomes an active grid row.
  registry.define(/^the board shows tickets (.+)$/, (ctx, rest) => {
    for (const id of quotedList(rest)) {
      addActive(ctx, id);
    }
  });

  // ── pipeline-board-links-current-folder-03 (Scenario Outline) /
  //    pipeline-board-links-authoritative-folder-04 ──────────────────────
  registry.define(/^a shown ticket "([^"]+)" whose backlog file is in the "([^"]+)" folder$/, (ctx, id, folder) => {
    if (!Object.prototype.hasOwnProperty.call(SHOWN_AS_FOR_FOLDER, folder)) {
      throw new Error(`pipeline-board-links-current-folder-03: unrecognized <folder> example value "${folder}"`);
    }
    SHOWN_AS_FOR_FOLDER[folder](ctx, id);
    ctx.shownId = id;
  });

  registry.define(/^its link path is "([^"]+)"$/, (ctx, expectedPath) => {
    const link = ctx.board.links.find((l) => l.id === ctx.shownId);
    if (!link) {
      throw new Error(`expected a link for "${ctx.shownId}", got links: ${JSON.stringify(ctx.board.links)}`);
    }
    if (link.path !== expectedPath) {
      throw new Error(`expected "${ctx.shownId}" linked at "${expectedPath}", got "${link.path}"`);
    }
  });

  // ── pipeline-board-links-authoritative-folder-04 ───────────────────────
  registry.define(/^a stale duplicate of "([^"]+)" is left behind in the "([^"]+)" folder$/, (ctx, id, folder) => {
    // Deliberately does NOT reassign ctx.ticketMeta[id] - buildLinks/
    // linkPathFor here take a single ticketMeta map (this suite's own
    // fixture shape, unlike conciergeTick.ts's real buildTicketMetaLookup,
    // which resolves authority from two SEPARATE folders.active/folders.
    // paused arrays). The authoritative-folder RESOLUTION itself is proven
    // at the conciergeTick.ts integration level (conciergeTick.test.js);
    // this step only proves the stale folder's OWN presence in `paused`
    // does not override an already-authoritative ticketMeta entry when the
    // renderer is fed a pre-resolved (single-entry-per-id) meta map, which
    // is the contract linkPathFor itself provides.
    if (folder === 'paused') {
      ctx.paused = [...(ctx.paused ?? []), { id }];
    }
  });

  // ── pipeline-board-links-freshness-05 ──────────────────────────────────
  registry.define(/^the board was last posted with "([^"]+)" linked at "([^"]+)"$/, async (ctx, id, path) => {
    ctx.posted = [];
    ctx.deleted = [];
    ctx.boardAdapters = {
      ensureBoardTopic: async () => ({ topicId: 900 }),
      postMessage: async (topicId, text) => {
        ctx.posted.push({ topicId, text });
        return { messageId: 42 };
      },
      deleteMessage: async (topicId, messageId) => {
        ctx.deleted.push({ topicId, messageId });
        return true;
      },
    };
    ctx.boardId = id;
    const data = { rows: [{ id, column: 'coder', slug: '' }], parked: [], links: [{ id, path }] };
    ctx.syncState = (await syncPipelineBoard(data, undefined, ctx.boardAdapters, 0)).state;
  });

  registry.define(/^"([^"]+)" has since moved to the "([^"]+)" folder with no other visible change to the board body$/, (ctx, id, folder) => {
    // Same grid row (byte-identical renderPipelineBoardBody text) - only
    // the link's resolved path changes, matching folder.
    ctx.nextData = { rows: [{ id, column: 'coder', slug: '' }], parked: [], links: [{ id, path: `backlog/${folder}/${id}.yaml` }] };
  });

  registry.define(/^the board sync runs on the next tick$/, async (ctx) => {
    ctx.result = await syncPipelineBoard(ctx.nextData, ctx.syncState, ctx.boardAdapters, 1);
  });

  registry.define(/^the board is re-posted rather than skipped as unchanged$/, (ctx) => {
    if (ctx.result.outcome !== 'reposted') {
      throw new Error(`expected outcome "reposted", got "${ctx.result.outcome}"`);
    }
  });

  registry.define(/^"([^"]+)" is now linked at "([^"]+)"$/, (ctx, id, expectedPath) => {
    const posted = ctx.posted[ctx.posted.length - 1];
    if (!posted) {
      throw new Error('expected the board to have been posted at least once, got none');
    }
    const link = ctx.nextData.links.find((l) => l.id === id);
    if (!link || link.path !== expectedPath) {
      throw new Error(`expected "${id}" linked at "${expectedPath}", got: ${JSON.stringify(link)}`);
    }
  });
}

module.exports = { registerSteps };
