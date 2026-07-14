'use strict';

// BL-293: step handlers for "Listen to the full Gherkin spec from the PWA
// ticket detail (reuse the BL-266 control)". Drives the REAL pwa/index.html
// + pwa/app.js + pwa/locales.js (via render-docs-ticket-listen.js, jsdom,
// mirroring recertListenSteps.js's own render-script pattern) - no live
// fetch, no real timers, no real speech synthesis (a fake adapter, per the
// ticket's own testable-module boundary).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-docs-ticket-listen.js');

const TICKET = {
  id: 'BL-100',
  title: 'cost telemetry',
  status: 'done',
  priority: 1,
  milestone: 'M4',
  description: 'Full prose description of BL-100.',
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
  registry.define(/^the static PWA's Gherkin full-detail view for a ticket$/, (ctx) => {
    ctx.ticket = TICKET;
    ctx.actions = [];
    ctx.speechAvailable = true;
  });

  // ── gherkin-listen-01 ────────────────────────────────────────────────
  registry.define(/^a ticket detail with a description and acceptance scenarios$/, (ctx) => {
    ctx.ticket = TICKET;
  });

  registry.define(/^the Listen control is activated$/, (ctx) => {
    ctx.actions.push('listen');
    ctx.result = render({ ticket: ctx.ticket, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
  });

  registry.define(/^the description and every scenario are read aloud on-device$/, (ctx) => {
    const spoken = ctx.result.spoken[0] && ctx.result.spoken[0].text;
    if (!spoken) {
      throw new Error(`expected an utterance to have been spoken, got: ${JSON.stringify(ctx.result)}`);
    }
    const descIndex = spoken.indexOf(TICKET.description);
    const firstIndex = spoken.indexOf(TICKET.scenarios[0].text);
    const secondIndex = spoken.indexOf(TICKET.scenarios[1].text);
    if (descIndex === -1 || firstIndex === -1 || secondIndex === -1) {
      throw new Error(`expected the description and both scenarios in the spoken text, got: ${spoken}`);
    }
    if (!(descIndex < firstIndex && firstIndex < secondIndex)) {
      throw new Error(`expected description then scenarios in order, got: ${spoken}`);
    }
  });

  registry.define(/^activating it again stops the reading$/, (ctx) => {
    const cancelledBefore = ctx.result.cancelledCount;
    ctx.actions.push('stop');
    ctx.result = render({ ticket: ctx.ticket, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
    if (!(ctx.result.cancelledCount > cancelledBefore)) {
      throw new Error(`expected cancel() to be called on stop, cancelledCount went from ${cancelledBefore} to ${ctx.result.cancelledCount}`);
    }
    if (ctx.result.ariaLabel !== 'Listen') {
      throw new Error(`expected the control to read "Listen" again once stopped, got: ${ctx.result.ariaLabel}`);
    }
  });

  // ── gherkin-listen-02 ────────────────────────────────────────────────
  registry.define(/^a device without speech synthesis$/, (ctx) => {
    ctx.speechAvailable = false;
  });

  registry.define(/^the ticket detail renders$/, (ctx) => {
    ctx.result = render({ ticket: ctx.ticket, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
  });

  registry.define(/^a listen-unavailable note shows in place of the control$/, (ctx) => {
    if (ctx.result.hasListenButton) {
      throw new Error(`expected no Listen control when speech synthesis is unavailable, got: ${JSON.stringify(ctx.result)}`);
    }
    if (!ctx.result.hasUnavailableNote) {
      throw new Error(`expected a listen-unavailable note, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  // ── gherkin-listen-03 ────────────────────────────────────────────────
  registry.define(/^a rendered Listen toggle$/, (ctx) => {
    ctx.ticket = TICKET;
  });

  registry.define(/^it moves between listening and stopped$/, (ctx) => {
    ctx.actions.push('listen');
    ctx.startedResult = render({ ticket: ctx.ticket, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
    ctx.actions.push('stop');
    ctx.stoppedResult = render({ ticket: ctx.ticket, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
  });

  registry.define(/^its aria-label tracks the current state$/, (ctx) => {
    if (ctx.startedResult.ariaLabel !== 'Stop') {
      throw new Error(`expected aria-label "Stop" while speaking, got: ${ctx.startedResult.ariaLabel}`);
    }
    if (ctx.stoppedResult.ariaLabel !== 'Listen') {
      throw new Error(`expected aria-label "Listen" once stopped, got: ${ctx.stoppedResult.ariaLabel}`);
    }
  });

  registry.define(/^it is operable by keyboard$/, (ctx) => {
    if (ctx.startedResult.buttonType !== 'button' || ctx.stoppedResult.buttonType !== 'button') {
      throw new Error('expected a real <button type="button"> at every state (native keyboard operability), not a div/span with a click handler');
    }
  });
}

module.exports = { registerSteps };
