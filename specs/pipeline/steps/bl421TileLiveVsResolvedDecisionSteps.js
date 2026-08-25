'use strict';

// BL-421: step handlers for "an agent tile marks a decision menu LIVE only
// while the pane is actually awaiting an answer". Drives the REAL compiled
// classifyDecisionStatus (needsHumanDetection.ts) directly - the host-side
// module surface, never the VS Code UI - so the acceptance run proves the
// same pure classifier the unit tests and the paneTailer wiring both use.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { classifyDecisionStatus } = require(path.join(EXT_OUT, 'panel', 'needsHumanDetection'));

const DECISION_MENU =
  'How should I split this into tickets?\n❯ 1) Two tickets (Recommended)\n  2) One ticket\n  3) Ask for more detail';
const CLEARED_PROMPT = 'sonnet-4.5\n❯ ';
const UNRELATED_LATER_OUTPUT = 'Implemented the split.\nRunning tests...\n❯ ';
const NO_MENU_OUTPUT = 'Just some normal agent output.\nNothing to see here.\n❯ ';

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^a decision-menu status is classified from a tile's current captured frame and its reconstructed transcript$/,
    (ctx) => {
      ctx.currentFrame = undefined;
      ctx.transcript = undefined;
    }
  );

  // ── tile-decision-status-01 ──────────────────────────────────────────
  registry.define(/^the pane's current frame is a decision menu still awaiting a human answer$/, (ctx) => {
    ctx.currentFrame = DECISION_MENU;
    ctx.transcript = DECISION_MENU;
  });

  // ── tile-decision-status-02 ──────────────────────────────────────────
  registry.define(/^the pane's current frame is an empty cleared prompt$/, (ctx) => {
    ctx.currentFrame = CLEARED_PROMPT;
  });

  registry.define(/^the reconstructed transcript still shows an earlier decision menu$/, (ctx) => {
    ctx.transcript = `${DECISION_MENU}\n${CLEARED_PROMPT}`;
  });

  // ── tile-decision-status-03 ──────────────────────────────────────────
  registry.define(/^the reconstructed transcript ends with a decision menu identical to a live one$/, (ctx) => {
    ctx.transcript = DECISION_MENU;
  });

  registry.define(/^the pane's current frame shows the agent producing unrelated later output$/, (ctx) => {
    ctx.currentFrame = UNRELATED_LATER_OUTPUT;
  });

  // ── tile-decision-status-04 ──────────────────────────────────────────
  registry.define(/^neither the current frame nor the transcript contains a decision menu$/, (ctx) => {
    ctx.currentFrame = NO_MENU_OUTPUT;
    ctx.transcript = NO_MENU_OUTPUT;
  });

  // ── shared When ───────────────────────────────────────────────────────
  registry.define(/^the tile's decision status is classified$/, (ctx) => {
    ctx.status = classifyDecisionStatus(ctx.currentFrame, ctx.transcript);
  });

  // ── shared Thens ──────────────────────────────────────────────────────
  registry.define(/^the menu is marked LIVE and presented as awaiting input$/, (ctx) => {
    if (ctx.status !== 'live') {
      throw new Error(`expected the decision status to be LIVE, got "${ctx.status}"`);
    }
  });

  registry.define(/^the menu is marked RESOLVED and not presented as actionable$/, (ctx) => {
    if (ctx.status !== 'resolved') {
      throw new Error(`expected the decision status to be RESOLVED, got "${ctx.status}"`);
    }
  });

  registry.define(/^the menu is marked RESOLVED rather than LIVE$/, (ctx) => {
    if (ctx.status !== 'resolved') {
      throw new Error(`expected the decision status to be RESOLVED (not LIVE), got "${ctx.status}"`);
    }
  });

  registry.define(/^no LIVE or RESOLVED marker is shown$/, (ctx) => {
    if (ctx.status !== 'none') {
      throw new Error(`expected no decision marker ("none"), got "${ctx.status}"`);
    }
  });
}

module.exports = { registerSteps };
