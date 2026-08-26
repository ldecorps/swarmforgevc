'use strict';

// BL-271: step handlers for "the phone app's recert view has a Listen (TTS)
// control". Drives the REAL pwa/index.html + pwa/app.js + pwa/locales.js
// (via render-recert-listen.js, jsdom, mirroring
// approvalTicketDetailSteps.js's own render-script pattern) - no live
// fetch, no real timers, no real speech synthesis (a fake adapter, per the
// ticket's own testable-module boundary: assert the utterance plan, not
// audio).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-recert-listen.js');

const SCENARIO_A = {
  id: 'BL-096/metrics-01',
  ticketId: 'BL-096',
  name: 'velocity series matches git-recorded closes',
  text: 'Scenario: velocity series matches git-recorded closes\n  Given a repo\n  Then counts match',
};

function render(config) {
  const out = execFileSync('node', [RENDER_SCRIPT, JSON.stringify(config)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the phone app's recert view renders the recert batch$/, (ctx) => {
    ctx.batch = [SCENARIO_A];
    ctx.actions = [];
    ctx.speechAvailable = true;
  });

  // ── recert-listen-01 ────────────────────────────────────────────────
  registry.define(/^a scenario is shown for recertification$/, (ctx) => {
    ctx.batch = [SCENARIO_A];
  });

  registry.define(/^the user activates the Listen control in the recert view$/, (ctx) => {
    ctx.actions.push('listen');
    ctx.result = render({ batch: ctx.batch, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
  });

  registry.define(/^the spoken text is that scenario's name followed by its Gherkin text$/, (ctx) => {
    const spoken = ctx.result.spoken[0] && ctx.result.spoken[0].text;
    if (!spoken) {
      throw new Error(`expected an utterance to have been spoken, got: ${JSON.stringify(ctx.result)}`);
    }
    const nameIndex = spoken.indexOf(SCENARIO_A.name);
    const textIndex = spoken.indexOf(SCENARIO_A.text);
    if (nameIndex === -1 || textIndex === -1 || !(nameIndex < textIndex)) {
      throw new Error(`expected the scenario name then its Gherkin text, got: ${spoken}`);
    }
  });

  // ── recert-listen-02 ────────────────────────────────────────────────
  registry.define(/^the user starts and then stops listening in the recert view$/, (ctx) => {
    ctx.actions.push('listen');
    ctx.result = render({ batch: ctx.batch, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
    ctx.startedAriaLabel = ctx.result.ariaLabel;
    ctx.actions.push('stop');
    ctx.result = render({ batch: ctx.batch, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
    ctx.stoppedAriaLabel = ctx.result.ariaLabel;
  });

  registry.define(/^the control's accessible label is the localized Listen label when idle and the Stop label while speaking$/, (ctx) => {
    if (ctx.startedAriaLabel !== 'Stop') {
      throw new Error(`expected aria-label "Stop" while speaking, got: ${ctx.startedAriaLabel}`);
    }
    if (ctx.stoppedAriaLabel !== 'Listen') {
      throw new Error(`expected aria-label "Listen" once idle again, got: ${ctx.stoppedAriaLabel}`);
    }
  });

  // ── recert-listen-03 ────────────────────────────────────────────────
  registry.define(/^no scenario needs recertification$/, (ctx) => {
    ctx.batch = [];
  });

  registry.define(/^the recert view is rendered$/, (ctx) => {
    ctx.result = render({ batch: ctx.batch, actions: ctx.actions, speechAvailable: ctx.speechAvailable });
  });

  registry.define(/^no Listen control is shown$/, (ctx) => {
    if (ctx.result.hasListenButton) {
      throw new Error(`expected no Listen control, got: ${JSON.stringify(ctx.result)}`);
    }
  });
}

module.exports = { registerSteps };
