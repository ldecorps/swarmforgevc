'use strict';

// BL-280: step handlers for "the phone recert view shows the backlog item a
// scenario belongs to, with tap-through". Drives the REAL pwa/index.html +
// pwa/app.js + pwa/locales.js (via render-recert-backlog-context.js, jsdom,
// mirroring recertListenSteps.js's own render-script pattern) - no live
// fetch, no real timers.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-recert-backlog-context.js');

const SCENARIO_BASE = {
  id: 'BL-096/metrics-01',
  ticketId: 'BL-096',
  name: 'velocity series matches git-recorded closes',
  text: 'Scenario: velocity series matches git-recorded closes\n  Given a repo\n  Then counts match',
};

const TICKET_BASE = {
  id: 'BL-096',
  title: 'Metrics dashboard',
  status: 'active',
  priority: 5,
  milestone: 'M4',
  description: 'Full description of BL-096.',
  scenarios: [],
};

function render(config) {
  const out = execFileSync('node', [RENDER_SCRIPT, JSON.stringify(config)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the phone recert view is showing a scenario for recertification$/, (ctx) => {
    ctx.scenario = { ...SCENARIO_BASE };
    ctx.ticket = null;
    ctx.locale = undefined;
    ctx.tapTicketLine = false;
  });

  // ── recert-context-01 / recert-context-02 ───────────────────────────
  registry.define(/^the scenario resolves to a backlog ticket$/, (ctx) => {
    ctx.scenario = { ...SCENARIO_BASE, ticketTitle: TICKET_BASE.title };
    ctx.ticket = { ...TICKET_BASE };
  });

  registry.define(/^the recert card is rendered$/, (ctx) => {
    ctx.result = render({ scenario: ctx.scenario, ticket: ctx.ticket, locale: ctx.locale, tapTicketLine: false });
  });

  registry.define(/^it shows the ticket's id and title above the scenario$/, (ctx) => {
    if (ctx.result.contextText !== `${ctx.scenario.ticketId} — ${ctx.scenario.ticketTitle}`) {
      throw new Error(`expected the id + title above the scenario, got: ${ctx.result.contextText}`);
    }
  });

  registry.define(/^the caller taps the ticket line$/, (ctx) => {
    ctx.result = render({ scenario: ctx.scenario, ticket: ctx.ticket, locale: ctx.locale, tapTicketLine: true });
  });

  registry.define(/^the ticket's full detail opens in the docs explorer$/, (ctx) => {
    if (!ctx.result.docsExplorerText.includes(ctx.ticket.description)) {
      throw new Error(`expected the docs explorer to open the ticket's full detail, got: ${ctx.result.docsExplorerText}`);
    }
  });

  // ── recert-context-03 ────────────────────────────────────────────────
  registry.define(/^the active locale is French and the ticket has a French title$/, (ctx) => {
    ctx.scenario = { ...SCENARIO_BASE, ticketTitle: TICKET_BASE.title, ticketTitleFr: 'Tableau de bord des métriques' };
    ctx.ticket = { ...TICKET_BASE };
    ctx.locale = 'fr';
  });

  registry.define(/^the French title is shown$/, (ctx) => {
    if (ctx.result.contextText !== `${ctx.scenario.ticketId} — ${ctx.scenario.ticketTitleFr}`) {
      throw new Error(`expected the French title, got: ${ctx.result.contextText}`);
    }
  });

  // ── recert-context-04 ────────────────────────────────────────────────
  registry.define(/^the scenario has no resolvable ticket$/, (ctx) => {
    ctx.scenario = { ...SCENARIO_BASE };
    ctx.ticket = null;
  });

  registry.define(/^only the scenario's ticket id is shown, with no link and no error$/, (ctx) => {
    if (ctx.result.contextText !== ctx.scenario.ticketId) {
      throw new Error(`expected only the bare ticket id, got: ${ctx.result.contextText}`);
    }
    if (ctx.result.contextTag !== 'P') {
      throw new Error(`expected a plain, non-interactive element (no link), got tag: ${ctx.result.contextTag}`);
    }
  });
}

module.exports = { registerSteps };
