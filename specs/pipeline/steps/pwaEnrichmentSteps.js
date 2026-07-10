'use strict';

// BL-257: step handlers for the LIVE-scoped slices of "the phone app gains
// backlog filtering, per-ticket timelines, a since-last-visit view, and
// live metric trends" - backlog-board-filter-search-01,
// per-ticket-timeline-02, and empty-state-graceful-05 (scoped to those two
// views). Drives the REAL pwa/index.html + pwa/app.js + pwa/locales.js
// (via render-pwa-enrichment.js, jsdom, mirroring
// render-docs-untranslated.js's own render-script pattern) - no live
// fetch, no real timers.
//
// changed-since-last-visit-03 and live-briefing-trends-04 are PARKED (see
// BL-257-pwa-enrichment.slice-3-4-live.feature.draft) - both need live,
// host/bridge-connected data (extension-host-persisted last-visit marker;
// the live holistic metric feed) that the STATIC deployed pwa/app.js
// cannot reach at all (confirmed: zero bridge/token/localhost reference
// anywhere in pwa/app.js). Per BL-252's own already-approved precedent
// (machine-local/live data -> the holistic UI + briefing, never
// backlog.json/pwa/app.js), those two slices belong on
// extension/src/bridge/holisticUiHtml.ts instead - a materially different,
// currently-unbuilt scope flagged to the specifier/architect rather than
// forced into this ticket's literal (and internally inconsistent -
// "extend pwa/app.js" vs "reuse BL-094 [bridge] plumbing") file naming.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-pwa-enrichment.js');

function render(config) {
  const out = execFileSync('node', [RENDER_SCRIPT, JSON.stringify(config)], { encoding: 'utf8' });
  return JSON.parse(out);
}

const VARIED_BOARD = {
  active: [
    { id: 'BL-100', title: 'cost telemetry', status: 'active', priority: 5 },
    { id: 'BL-101', title: 'suite duration trend', status: 'active', priority: 12 },
  ],
  paused: [{ id: 'BL-102', title: 'cost telemetry followup', status: 'paused', priority: 5 }],
  doneByMilestone: { M4: [{ id: 'BL-096', title: 'metrics', status: 'done', priority: 5 }] },
};

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the phone app reading backlog\.json and the live metric feed$/, (ctx) => {
    ctx.actions = [];
    ctx.tickets = [];
  });

  // ── backlog-board-filter-search-01 ──────────────────────────────────
  registry.define(/^the backlog board with tickets of varying status and priority$/, (ctx) => {
    ctx.board = VARIED_BOARD;
  });

  registry.define(/^the operator filters or searches the board by status, priority, or text$/, (ctx) => {
    ctx.actions.push({ type: 'filterQuery', value: 'cost telemetry' });
    ctx.result = render({ board: ctx.board, tickets: ctx.tickets, actions: ctx.actions });
  });

  registry.define(/^only the matching tickets remain on the board$/, (ctx) => {
    const text = ctx.result.boardText;
    if (text.indexOf('BL-100') === -1 || text.indexOf('BL-102') === -1) {
      throw new Error(`expected matching tickets BL-100/BL-102 to remain, got: ${text}`);
    }
    if (text.indexOf('BL-101') !== -1) {
      throw new Error(`expected non-matching ticket BL-101 to be filtered out, got: ${text}`);
    }
  });

  // ── per-ticket-timeline-02 ───────────────────────────────────────────
  registry.define(/^a ticket with git-derived lifecycle events$/, (ctx) => {
    ctx.tickets = [
      {
        id: 'BL-100',
        title: 'cost telemetry',
        status: 'done',
        milestone: 'M4',
        specDateIso: '2026-07-01T00:00:00Z',
        closeDateIso: '2026-07-05T00:00:00Z',
      },
    ];
    ctx.board = { active: [], paused: [], doneByMilestone: {} };
  });

  registry.define(/^the operator opens that ticket's timeline$/, (ctx) => {
    ctx.actions.push({ type: 'openMilestone', milestone: 'M4' }, { type: 'openTicket', id: 'BL-100' });
    ctx.result = render({ board: ctx.board, tickets: ctx.tickets, actions: ctx.actions });
  });

  registry.define(/^it shows the ticket's stages in order with their timestamps$/, (ctx) => {
    const text = ctx.result.docsExplorerText;
    const speccedIndex = text.indexOf('2026-07-01');
    const closedIndex = text.indexOf('2026-07-05');
    if (speccedIndex === -1 || closedIndex === -1) {
      throw new Error(`expected both timeline dates shown, got: ${text}`);
    }
    if (speccedIndex >= closedIndex) {
      throw new Error(`expected specced before closed, in order, got: ${text}`);
    }
  });

  // ── empty-state-graceful-05 (scoped to the board filter + timeline views) ──
  registry.define(/^an enrichment view whose data is unavailable$/, (ctx) => {
    ctx.board = VARIED_BOARD;
    ctx.tickets = [{ id: 'BL-100', title: 'cost telemetry', status: 'active', milestone: 'M4' }]; // no specDateIso
    ctx.actions.push({ type: 'filterQuery', value: 'no such ticket anywhere' }, { type: 'openMilestone', milestone: 'M4' }, { type: 'openTicket', id: 'BL-100' });
  });

  registry.define(/^the operator opens it$/, (ctx) => {
    ctx.result = render({ board: ctx.board, tickets: ctx.tickets, actions: ctx.actions });
  });

  registry.define(/^it shows a localized empty state rather than an error or a blank$/, (ctx) => {
    if (ctx.result.boardText.indexOf('No tickets match your filter') === -1) {
      throw new Error(`expected the board's localized no-results state, got: ${ctx.result.boardText}`);
    }
    if (ctx.result.docsExplorerText.indexOf('No timeline data available') === -1) {
      throw new Error(`expected the timeline's localized empty state, got: ${ctx.result.docsExplorerText}`);
    }
  });
}

module.exports = { registerSteps };
