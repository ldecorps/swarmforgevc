'use strict';

// BL-465: step handlers for "The pipeline board shows wider descriptions,
// distinct sections for parked/paused/intake/recently-closed, and a GitHub
// link list below the grid". Drives the REAL compiled computePipelineBoard/
// renderPipelineBoard/renderPipelineBoardBody/renderPipelineBoardLinks
// (pipelineBoard.ts) against fixture data - never a hand-rolled
// reimplementation of the render rules, mirroring bl452/bl455's own step
// file convention.
//
// NOTE on "paused" vs "parked" (board-round2-03's own Examples table): the
// codebase's own vocabulary already uses "parked"/"paused" interchangeably
// for backlog/paused/ folder items (the UI section is literally named
// PARKED: while the folder itself is named backlog/paused/ - see e.g.
// pipelineBoard.ts's own PARKED_SECTION_HEADER next to
// PipelineBoardPausedItem). No structural field in the real backlog schema
// distinguishes a third "paused-but-not-parked" bucket (backlogReader.ts's
// own comment explicitly normalizes any status value outside
// todo/active/done, e.g. "blocked", away to undefined) - so this file
// treats the Examples table's "paused" kind as the SAME PARKED: section
// "parked" already covers, a deliberate, documented judgment call rather
// than inventing an unverifiable fourth bucket.

const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { computePipelineBoard, renderPipelineBoard, renderPipelineBoardBody, renderPipelineBoardLinks, wrapPipelineBoardHtml } = require(
  path.join(EXT_OUT, 'concierge', 'pipelineBoard')
);

const REPO_BASE_URL = 'https://github.com/ldecorps/swarmforgevc';
const LONG_TITLE = 'Pipeline board shows a lot more of the title now';

function render(ctx) {
  // BL-473: ctx.activeIds is a new, optional field (undefined for every
  // pre-existing scenario in this file) - forwarded as-is so
  // computePipelineBoard's own default (derive membership from
  // roleHeldTickets when omitted) keeps every scenario below rendering
  // identically; only bl473PipelineBoardActiveMembershipSteps.js's Given
  // steps set it.
  ctx.board = computePipelineBoard(ctx.roleHeldTickets ?? {}, ctx.paused ?? [], ctx.ticketMeta ?? {}, {
    rootIntake: ctx.rootIntake ?? [],
    recentlyClosed: ctx.recentlyClosed ?? [],
    repoBaseUrl: ctx.repoBaseUrl,
    activeIds: ctx.activeIds,
  });
  ctx.gridText = renderPipelineBoard(ctx.board, 0);
  ctx.linksHtml = renderPipelineBoardLinks(ctx.board.links, ctx.repoBaseUrl);
  ctx.html = wrapPipelineBoardHtml(ctx.gridText, ctx.linksHtml);
}

function registerSteps(registry) {
  // ── board-round2-01 ────────────────────────────────────────────────────
  registry.define(/^a long-titled ticket occupies a stage-grid row$/, (ctx) => {
    ctx.roleHeldTickets = { coder: ['BL-1'] };
    ctx.ticketMeta = { 'BL-1': { title: LONG_TITLE } };
  });

  // "the pipeline board is rendered" is NOT registered here - bl452's own
  // handler (registered first) delegates to this file's exported render()
  // when ctx has this file's own shape (see bl452PipelineBoardSteps.js's
  // own dispatch comment).

  registry.define(/^the grid row's slug column shows the ticket's short kebab slug$/, (ctx) => {
    const row = ctx.board.rows.find((r) => r.id === 'BL-1');
    if (!row || row.slug !== 'pipeline-board-shows') {
      throw new Error(`expected the grid row's slug to be the short kebab slug "pipeline-board-shows", got: ${JSON.stringify(row)}`);
    }
  });

  registry.define(/^the grid row remains a single aligned line$/, (ctx) => {
    const line = ctx.gridText.split('\n').find((l) => l.startsWith('BL-1'));
    if (!line || line.includes('\n')) {
      throw new Error(`expected BL-1's row on a single line, got: ${JSON.stringify(line)}`);
    }
  });

  // ── board-round2-01b (Scenario Outline: parked list / recently-closed) ──
  registry.define(/^a long-titled ticket appears under the "([^"]+)" section$/, (ctx, list) => {
    if (list === 'parked list') {
      ctx.paused = [{ id: 'BL-2' }];
      ctx.ticketMeta = { 'BL-2': { title: LONG_TITLE } };
      ctx.expectId = 'BL-2';
    } else if (list === 'recently-closed') {
      ctx.recentlyClosed = [{ id: 'BL-3', title: LONG_TITLE, filename: 'BL-3-closed.yaml' }];
      ctx.expectId = 'BL-3';
    } else {
      throw new Error(`board-round2-01b: unrecognized <list> example value "${list}"`);
    }
    ctx.list = list;
  });

  registry.define(/^the "([^"]+)" entry leads with a short kebab slug for the ticket$/, (ctx, list) => {
    const entries = list === 'parked list' ? ctx.board.parked : ctx.board.recentlyClosed;
    const entry = entries.find((e) => e.id === ctx.expectId);
    if (!entry || !entry.slug.startsWith('pipeline-board-shows ')) {
      throw new Error(`expected the "${list}" entry to lead with the kebab slug, got: ${JSON.stringify(entry)}`);
    }
  });

  registry.define(/^it then shows more of the title than the previous limit allowed$/, (ctx) => {
    const entries = ctx.list === 'parked list' ? ctx.board.parked : ctx.board.recentlyClosed;
    const entry = entries.find((e) => e.id === ctx.expectId);
    // The previous (BL-462) slug bound was 40 chars - the wider list entry
    // must carry more of the title than that bound alone would have.
    if (entry.slug.length <= 40) {
      throw new Error(`expected the list entry to carry more than the previous 40-char limit, got: "${entry.slug}" (${entry.slug.length} chars)`);
    }
    if (!entry.slug.includes(LONG_TITLE)) {
      throw new Error(`expected the FULL title to fit in the wider list entry, got: "${entry.slug}"`);
    }
  });

  registry.define(/^the whole entry is still a single line$/, (ctx) => {
    const entries = ctx.list === 'parked list' ? ctx.board.parked : ctx.board.recentlyClosed;
    const entry = entries.find((e) => e.id === ctx.expectId);
    if (entry.slug.includes('\n')) {
      throw new Error(`expected a single line, got: "${entry.slug}"`);
    }
  });

  // ── board-round2-02 ─────────────────────────────────────────────────────
  registry.define(/^a parked ticket in the parked section$/, (ctx) => {
    ctx.paused = [
      { id: 'BL-4' },
      { id: 'BL-5', humanApproval: 'pending' },
    ];
  });

  registry.define(/^the parked entry does not repeat a per-line "PK" label$/, (ctx) => {
    const lines = renderPipelineBoardBody(ctx.board).split('\n');
    const bl4Line = lines.find((l) => l.includes('BL-4'));
    if (!bl4Line || bl4Line.trim().startsWith('PK')) {
      throw new Error(`expected no per-line PK label, got: ${bl4Line}`);
    }
  });

  registry.define(/^an awaiting-approval ticket is distinguished by its own section, not a per-line label$/, (ctx) => {
    const lines = renderPipelineBoardBody(ctx.board).split('\n');
    const bl5Line = lines.find((l) => l.includes('BL-5'));
    if (!bl5Line || bl5Line.trim().startsWith('AA')) {
      throw new Error(`expected no per-line AA label, got: ${bl5Line}`);
    }
    const awaitingHeaderIndex = lines.findIndex((l) => l.trim() === 'AWAITING APPROVAL:');
    const bl5Index = lines.indexOf(bl5Line);
    if (awaitingHeaderIndex < 0 || awaitingHeaderIndex >= bl5Index) {
      throw new Error(`expected BL-5 under its own AWAITING APPROVAL: section, got:\n${lines.join('\n')}`);
    }
  });

  // ── board-round2-03 (Scenario Outline) ──────────────────────────────────
  const SECTION_HEADER_FOR = {
    parked: 'PARKED:',
    'awaiting-approval': 'AWAITING APPROVAL:',
    paused: 'PARKED:', // see this file's own top-of-file note
    'root-intake': 'ROOT INTAKE:',
    'recently-closed': 'RECENTLY CLOSED:',
  };

  registry.define(/^a "([^"]+)" item exists$/, (ctx, kind) => {
    if (!Object.prototype.hasOwnProperty.call(SECTION_HEADER_FOR, kind)) {
      throw new Error(`board-round2-03: unrecognized <kind> example value "${kind}"`);
    }
    ctx.kind = kind;
    ctx.expectId = 'BL-6';
    if (kind === 'parked' || kind === 'paused') {
      ctx.paused = [{ id: ctx.expectId }];
    } else if (kind === 'awaiting-approval') {
      ctx.paused = [{ id: ctx.expectId, humanApproval: 'pending' }];
    } else if (kind === 'root-intake') {
      ctx.rootIntake = [{ id: 'INTAKE-1', title: 'a raw ask', filename: 'INTAKE-1.md' }];
      ctx.expectId = 'INTAKE-1';
    } else if (kind === 'recently-closed') {
      ctx.recentlyClosed = [{ id: ctx.expectId, title: 'shipped thing', filename: `${ctx.expectId}-shipped.yaml` }];
    }
  });

  registry.define(/^the board shows it under the "([^"]+)" section$/, (ctx, kind) => {
    const header = SECTION_HEADER_FOR[kind];
    const lines = renderPipelineBoardBody(ctx.board).split('\n');
    const headerIndex = lines.findIndex((l) => l.trim() === header);
    if (headerIndex < 0) {
      throw new Error(`expected a "${header}" section, got:\n${lines.join('\n')}`);
    }
    const itemLine = lines.find((l) => l.includes(ctx.expectId));
    if (!itemLine) {
      throw new Error(`expected ${ctx.expectId} to appear somewhere in the board, got:\n${lines.join('\n')}`);
    }
    if (lines.indexOf(itemLine) <= headerIndex) {
      throw new Error(`expected ${ctx.expectId} AFTER the "${header}" header, got:\n${lines.join('\n')}`);
    }
  });

  // ── board-round2-04 ─────────────────────────────────────────────────────
  registry.define(/^active, parked, and recently-closed tickets on the board$/, (ctx) => {
    ctx.roleHeldTickets = { coder: ['BL-1'] };
    ctx.ticketMeta = { 'BL-1': { title: 'active one', filename: 'BL-1-active-one.yaml', location: 'active' } };
    ctx.paused = [{ id: 'BL-2' }];
    ctx.ticketMeta['BL-2'] = { title: 'paused one', filename: 'BL-2-paused-one.yaml', location: 'paused' };
    ctx.recentlyClosed = [{ id: 'BL-3', title: 'closed one', filename: 'BL-3-closed-one.yaml' }];
    ctx.repoBaseUrl = REPO_BASE_URL;
  });

  registry.define(/^a link list below the grid links each ticket id to its backlog file on GitHub$/, (ctx) => {
    if (!ctx.linksHtml.includes('LINKS:')) {
      throw new Error(`expected a link list, got: ${ctx.linksHtml}`);
    }
    for (const id of ['BL-1', 'BL-2', 'BL-3']) {
      if (!ctx.linksHtml.includes(`${REPO_BASE_URL}/blob/main/`) || !ctx.linksHtml.includes(id)) {
        throw new Error(`expected ${id} to have a GitHub link, got: ${ctx.linksHtml}`);
      }
    }
  });

  registry.define(
    /^an active ticket links under backlog\/active, a paused one under backlog\/paused, and a closed one under backlog\/done$/,
    (ctx) => {
      const activeLink = ctx.board.links.find((l) => l.id === 'BL-1');
      const pausedLink = ctx.board.links.find((l) => l.id === 'BL-2');
      const closedLink = ctx.board.links.find((l) => l.id === 'BL-3');
      if (!activeLink || !activeLink.path.startsWith('backlog/active/')) {
        throw new Error(`expected BL-1 linked under backlog/active, got: ${JSON.stringify(activeLink)}`);
      }
      if (!pausedLink || !pausedLink.path.startsWith('backlog/paused/')) {
        throw new Error(`expected BL-2 linked under backlog/paused, got: ${JSON.stringify(pausedLink)}`);
      }
      if (!closedLink || !closedLink.path.startsWith('backlog/done/')) {
        throw new Error(`expected BL-3 linked under backlog/done, got: ${JSON.stringify(closedLink)}`);
      }
    }
  );

  // ── board-round2-05 ─────────────────────────────────────────────────────
  registry.define(/^the board carries hyperlinks in the link list below the grid$/, (ctx) => {
    ctx.roleHeldTickets = { coder: ['BL-1'] };
    ctx.ticketMeta = { 'BL-1': { title: 'active one', filename: 'BL-1-active-one.yaml', location: 'active' } };
    ctx.repoBaseUrl = REPO_BASE_URL;
  });

  registry.define(/^the stage grid itself remains an aligned monospace block with no links inside it$/, (ctx) => {
    const preMatch = ctx.html.match(/<pre>([\s\S]*?)<\/pre>/);
    if (!preMatch) {
      throw new Error(`expected a <pre> block, got: ${ctx.html}`);
    }
    if (preMatch[1].includes('<a href')) {
      throw new Error(`expected NO <a href> tag inside the <pre> block, got: ${preMatch[1]}`);
    }
    if (!ctx.html.includes('<a href')) {
      throw new Error(`expected the link list to still be present, outside the <pre> block, got: ${ctx.html}`);
    }
  });
}

module.exports = { registerSteps, render };
