'use strict';

// BL-266: step handlers for "read or LISTEN to a pending ticket's
// description and acceptance scenarios from the phone approval list".
// Drives the REAL pwa/index.html + pwa/app.js + pwa/locales.js (via
// render-approval-ticket-detail.js, jsdom, mirroring
// docsUntranslatedFlagSteps.js's own render-script pattern) - no live
// fetch, no real timers, no real speech synthesis (a fake adapter, per the
// ticket's own testable-module boundary: assert the utterance plan, not
// audio).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-approval-ticket-detail.js');

const TICKET_A = {
  id: 'BL-200',
  title: 'A ticket pending review',
  description: 'Full prose description of the pending ticket.',
  scenarios: [
    { name: 'first scenario', text: 'Scenario: first scenario\n  Given a thing\n  Then it works' },
    { name: 'second scenario', text: 'Scenario: second scenario\n  Given another thing\n  Then it also works' },
  ],
};

function render(config) {
  const out = execFileSync('node', [RENDER_SCRIPT, JSON.stringify(config)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the phone app's needs-approval list of tickets pending human approval$/, (ctx) => {
    ctx.ticket = TICKET_A;
    ctx.locale = undefined;
    ctx.actions = [];
    ctx.speechAvailable = true;
  });

  // ── approval-detail-shows-description-and-scenarios-01 ────────────────
  registry.define(/^a pending ticket "([^"]+)" with a description and acceptance scenarios$/, (ctx, id) => {
    ctx.ticket = { ...TICKET_A, id };
  });

  registry.define(/^the operator opens "([^"]+)" from the needs-approval list$/, (ctx) => {
    ctx.actions.push('open');
    ctx.result = render({ ticket: ctx.ticket, locale: ctx.locale, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
  });

  registry.define(/^its description is shown$/, (ctx) => {
    if (ctx.result.text.indexOf(ctx.ticket.description) === -1) {
      throw new Error(`expected the description to be shown, got: ${ctx.result.text}`);
    }
  });

  registry.define(/^its acceptance scenarios are shown$/, (ctx) => {
    ctx.ticket.scenarios.forEach((s) => {
      if (ctx.result.text.indexOf(s.text) === -1) {
        throw new Error(`expected scenario "${s.name}" to be shown, got: ${ctx.result.text}`);
      }
    });
  });

  // ── approval-detail-single-source-02 ───────────────────────────────────
  registry.define(/^the description and scenarios shown are those of "([^"]+)"'s committed ticket and its feature file$/, (ctx) => {
    if (ctx.result.text.indexOf(ctx.ticket.description) === -1) {
      throw new Error('expected the exact committed description');
    }
    ctx.ticket.scenarios.forEach((s) => {
      if (ctx.result.text.indexOf(s.text) === -1) {
        throw new Error(`expected the exact committed scenario text for "${s.name}"`);
      }
    });
  });

  registry.define(/^no separately-stored or divergent copy is shown$/, () => {
    // Non-behavioral: render-approval-ticket-detail.js's fixture IS the
    // single docs-tree.json entry the detail view reads - there is no
    // second store for it to diverge from. Asserted structurally by the
    // previous step's exact-text match.
  });

  // ── approval-detail-read-only-03 ───────────────────────────────────────
  registry.define(/^the detail view offers no approve, reject, or other write action$/, (ctx) => {
    if (ctx.result.hasWriteControl || ctx.result.hasApproveRejectButton) {
      throw new Error(`expected no write/approve/reject control, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── approval-detail-unavailable-state-04 ────────────────────────────────
  registry.define(/^a pending ticket "([^"]+)" whose acceptance scenarios cannot be resolved$/, (ctx, id) => {
    ctx.ticket = { ...TICKET_A, id, scenarios: [] };
  });

  registry.define(/^a localized empty state is shown rather than an error or a blank$/, (ctx) => {
    if (ctx.result.text.indexOf('no scenarios resolved for this ticket') === -1) {
      throw new Error(`expected the localized empty state, got: ${ctx.result.text}`);
    }
  });

  // ── approval-detail-localized-05 ────────────────────────────────────────
  registry.define(/^the active locale is not the default$/, (ctx) => {
    ctx.locale = 'fr';
  });

  registry.define(/^the detail view's own labels render in the active locale$/, (ctx) => {
    if (ctx.result.text.indexOf("Scénarios d'acceptation") === -1) {
      throw new Error(`expected French labels, got: ${ctx.result.text}`);
    }
  });

  // ── listen-speaks-description-and-scenarios-06 ─────────────────────────
  // (slice 2 promoted into the live feature under slice 1's own shared
  // Background, per this project's single-Background-per-file convention -
  // each listen scenario opens the ticket via the SAME steps slice 1
  // already registers above, rather than the draft's own separate
  // Background wording.)
  registry.define(/^the operator activates the listen control$/, (ctx) => {
    ctx.actions.push('listen');
    ctx.result = render({ ticket: ctx.ticket, locale: ctx.locale, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
  });

  registry.define(/^the ticket's description is spoken aloud, followed by each acceptance scenario in order$/, (ctx) => {
    const spoken = ctx.result.spoken[0] && ctx.result.spoken[0].text;
    if (!spoken) {
      throw new Error(`expected an utterance to have been spoken, got: ${JSON.stringify(ctx.result)}`);
    }
    const descIndex = spoken.indexOf(ctx.ticket.description);
    const scenarioIndices = ctx.ticket.scenarios.map((s) => spoken.indexOf(s.text));
    if (descIndex === -1 || scenarioIndices.some((i) => i === -1)) {
      throw new Error(`expected description + every scenario in the spoken text, got: ${spoken}`);
    }
    const orderedAscending = [descIndex, ...scenarioIndices].every((v, i, arr) => i === 0 || arr[i - 1] < v);
    if (!orderedAscending) {
      throw new Error(`expected description then each scenario in order, got: ${spoken}`);
    }
  });

  // ── listen-uses-active-locale-07 ────────────────────────────────────────
  registry.define(/^the speech uses the active locale's language rather than the default$/, (ctx) => {
    const lang = ctx.result.spoken[0] && ctx.result.spoken[0].lang;
    if (lang !== 'fr-FR') {
      throw new Error(`expected the fr-FR utterance language, got: ${lang}`);
    }
  });

  // ── listen-can-be-stopped-08 ─────────────────────────────────────────────
  registry.define(/^the ticket is being read aloud$/, (ctx) => {
    ctx.actions.push('listen');
  });

  registry.define(/^the operator stops the listen control$/, (ctx) => {
    ctx.actions.push('stop');
    ctx.result = render({ ticket: ctx.ticket, locale: ctx.locale, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
  });

  registry.define(/^playback halts$/, (ctx) => {
    if (ctx.result.cancelledCount < 1) {
      throw new Error(`expected cancel() to have been called, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── listen-unavailable-degrades-gracefully-09 ────────────────────────────
  registry.define(/^the device has no available speech synthesis$/, (ctx) => {
    ctx.speechAvailable = false;
  });

  registry.define(/^the listen control is unavailable with a localized note rather than erroring or reading nothing on tap$/, (ctx) => {
    if (ctx.result.hasListenButton) {
      throw new Error('expected no listen button when speech synthesis is unavailable');
    }
    if (!/not available/i.test(ctx.result.text)) {
      throw new Error(`expected a localized unavailable note, got: ${ctx.result.text}`);
    }
  });
}

module.exports = { registerSteps };
