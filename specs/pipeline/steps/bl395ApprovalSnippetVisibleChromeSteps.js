'use strict';

// BL-395: step handlers for "the NeedsApproval snippet carries the question,
// not the terminal's input box and footer". Drives the REAL compiled
// extractQuestionSnippet (needsHumanDetection.ts) directly for the pure
// extraction scenarios, and computeRoleGateStates (gateSnapshot.ts) for
// scenario 05 - the same single source BL-391's own step module
// (theHumanIsNeverSentTerminalChromeSteps.js) already established feeds
// both the Telegram send and the git-committed topic record.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { extractQuestionSnippet } = require(path.join(EXT_OUT, 'panel', 'needsHumanDetection'));
const { computeRoleGateStates } = require(path.join(EXT_OUT, 'bridge', 'gateSnapshot'));

const QUESTION = 'Should I deploy BL-900 to production?';
const BOX_RULE_LINE = '─'.repeat(60);
const BARE_PROMPT_LINE = '❯ ';
const FOOTER_LINE = '⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents';

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the human-facing approval snippet is extracted from an agent's captured pane$/, () => {
    // No shared fixture setup needed - each scenario's own Given builds its pane text.
  });

  // ── approval-chrome-01 ────────────────────────────────────────────────
  registry.define(/^a captured pane whose tail is the agent's input box drawn with box-rule lines$/, (ctx) => {
    ctx.pane = [QUESTION, BOX_RULE_LINE, BARE_PROMPT_LINE].join('\n');
  });

  registry.define(/^the approval snippet is extracted$/, (ctx) => {
    ctx.snippet = extractQuestionSnippet(ctx.pane);
  });

  registry.define(/^the snippet contains none of those box-rule border lines$/, (ctx) => {
    if (/─/.test(ctx.snippet)) {
      throw new Error(`expected no box-rule characters in the snippet, got: ${JSON.stringify(ctx.snippet)}`);
    }
  });

  // ── approval-chrome-02 ────────────────────────────────────────────────
  registry.define(/^a captured pane whose tail includes the terminal permission-mode and shortcut footer$/, (ctx) => {
    ctx.pane = [QUESTION, FOOTER_LINE].join('\n');
  });

  registry.define(/^the snippet contains none of that footer furniture$/, (ctx) => {
    if (/bypass permissions/i.test(ctx.snippet)) {
      throw new Error(`expected no footer furniture in the snippet, got: ${JSON.stringify(ctx.snippet)}`);
    }
  });

  // ── approval-chrome-03 ────────────────────────────────────────────────
  registry.define(/^a captured pane whose real question sits above its input box and footer$/, (ctx) => {
    ctx.pane = [QUESTION, BOX_RULE_LINE, BARE_PROMPT_LINE, FOOTER_LINE].join('\n');
  });

  registry.define(/^the snippet is that question text$/, (ctx) => {
    if (ctx.snippet !== QUESTION) {
      throw new Error(`expected the snippet to be exactly the question, got: ${JSON.stringify(ctx.snippet)}`);
    }
  });

  // ── approval-chrome-04 (neighbour guard) ──────────────────────────────
  registry.define(/^a human-facing message that is ordinary prose containing no terminal chrome$/, (ctx) => {
    ctx.pane = 'This is a well-formed sentence - with a dash - should it proceed?';
  });

  registry.define(/^the message is delivered unchanged$/, (ctx) => {
    if (ctx.snippet !== ctx.pane) {
      throw new Error(`expected ordinary prose to pass through unchanged, got: ${JSON.stringify(ctx.snippet)} want: ${JSON.stringify(ctx.pane)}`);
    }
  });

  // ── approval-chrome-05 ────────────────────────────────────────────────
  registry.define(/^a captured pane whose tail is terminal chrome$/, (ctx) => {
    ctx.pane = [QUESTION, BOX_RULE_LINE, BARE_PROMPT_LINE, FOOTER_LINE].join('\n');
  });

  registry.define(/^the snippet is recorded against the ticket$/, (ctx) => {
    const [gateState] = computeRoleGateStates(['coder'], () => ctx.pane);
    ctx.recordedSnippet = gateState.snippet;
  });

  registry.define(/^the recorded snippet contains none of that chrome$/, (ctx) => {
    if (/─/.test(ctx.recordedSnippet) || /bypass permissions/i.test(ctx.recordedSnippet) || /❯/.test(ctx.recordedSnippet)) {
      throw new Error(`expected the recorded snippet free of chrome, got: ${JSON.stringify(ctx.recordedSnippet)}`);
    }
    if (ctx.recordedSnippet !== QUESTION) {
      throw new Error(`expected the recorded snippet to be exactly the question, got: ${JSON.stringify(ctx.recordedSnippet)}`);
    }
  });
}

module.exports = { registerSteps };
