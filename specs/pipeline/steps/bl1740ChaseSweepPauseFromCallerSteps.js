'use strict';

// BL-1740: step handlers for "The chase sweep reads the pause from its
// caller, never from the checkout it runs in". Drives the REAL
// chase_sweep_lib.bb sweep-role-inbox! over a REAL scratch git checkout via
// lib/bl1740ChaseSweepPauseFromCallerCli.bb - never a restatement of the
// pause-read logic. Each Scenario Outline row builds its own fresh fixture
// (the CLI's own job), so the Background steps here only record narrative
// intent.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1740ChaseSweepPauseFromCallerCli.bb');

// BL-421/engineering.prompt Scenario Outline rule: the <pause adapter>
// column is validated against this explicit map, never a bare passthrough -
// translates the feature's own prose to the CLI's mode argument.
const KNOWN_PAUSE_ADAPTERS = {
  'no pause adapter': 'none',
  'a pause adapter reading false': 'false',
  'a pause adapter reading true': 'true',
  "handoff-lib's live pause reading": 'live',
};

function knownPauseAdapterMode(text) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_PAUSE_ADAPTERS, text)) {
    throw new Error(`BL-1740: unrecognized <pause adapter> example value "${text}"`);
  }
  return KNOWN_PAUSE_ADAPTERS[text];
}

function registerSteps(registry) {
  registry.define(/^a scratch git checkout whose control pause is active$/, () => {});

  registry.define(/^a fixture inbox holding one stale, unheld parcel for the coder$/, () => {});

  registry.define(/^the chase sweep runs from that checkout with (.+)$/, (ctx, adapterText) => {
    const mode = knownPauseAdapterMode(adapterText);
    const out = execFileSync('bb', [FIXTURE_CLI, mode], { encoding: 'utf8' });
    ctx.result = JSON.parse(out.trim().split('\n').pop());
  });

  registry.define(/^the parcel's chase count is (\d+)$/, (ctx, countText) => {
    assert.equal(ctx.result.chaseCount, Number(countText));
  });
}

module.exports = { registerSteps };
