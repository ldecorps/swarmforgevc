'use strict';

// BL-642: gate snippet shows the question, or honestly says it captured none.
// Drives the REAL compiled extractQuestionSnippet / detectNeedsHuman
// (needsHumanDetection.ts) — same single source BL-395 established.
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  extractQuestionSnippet,
  detectNeedsHuman,
  NO_QUESTION_TEXT_CAPTURED,
} = require(path.join(EXT_OUT, 'panel', 'needsHumanDetection'));

const FEATURE = 'a gated role\'s Telegram snippet shows the question, or honestly says it captured none';

// Live coder pane capture reproduced in the ticket source (BL-642).
const LIVE_CODER_PANE_CAPTURE = [
  '──────────────────────── SwarmForge Coder ──',
  '⏵⏵ bypass permissions on (shift+tab to cycle) · install gh for PR status · e…',
  '/rc',
].join('\n');

const FULL_FOOTER =
  '⏵⏵ bypass permissions on (shift+tab to cycle) · install gh for PR status · esc to interrupt';

const QUESTION_WITH_PERMISSIONS =
  'Should I change the bypass permissions setting for this role?';
const QUESTION_WITH_BOX =
  'Deploy along the ──── path, or abort?';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function registerSteps(registry) {
  scoped(registry, /^the live coder pane capture from source:$/, (ctx) => {
    ctx.bl642Pane = LIVE_CODER_PANE_CAPTURE;
    ctx.bl642Panes = null;
  });

  scoped(registry, /^a pane capture whose question line contains the word "permissions"$/, (ctx) => {
    ctx.bl642Panes = [QUESTION_WITH_PERMISSIONS];
  });

  scoped(registry, /^another pane capture whose question line contains box-drawing characters$/, (ctx) => {
    ctx.bl642Panes = ctx.bl642Panes || [];
    ctx.bl642Panes.push(QUESTION_WITH_BOX);
  });

  scoped(registry, /^a pane capture containing only chrome and no question text$/, (ctx) => {
    ctx.bl642Pane = [
      '─'.repeat(40),
      '──────────────────────── SwarmForge Architect ──',
      '⏵⏵ bypass permissions on (shift+tab to cycle) · install gh · e…',
      '❯ ',
      '/rc',
    ].join('\n');
    ctx.bl642Panes = null;
  });

  scoped(registry, /^a footer string cut to "([^"]+)" characters$/, (ctx, widthStr) => {
    const width = Number(widthStr);
    ctx.bl642TruncatedFooter = FULL_FOOTER.slice(0, width);
  });

  scoped(registry, /^extractQuestionSnippet runs on it$/, (ctx) => {
    ctx.bl642Snippet = extractQuestionSnippet(ctx.bl642Pane);
  });

  scoped(registry, /^extractQuestionSnippet runs on each$/, (ctx) => {
    ctx.bl642Snippets = (ctx.bl642Panes || []).map((pane) => extractQuestionSnippet(pane));
  });

  scoped(registry, /^extractQuestionSnippet runs on a pane capture ending in that truncated footer$/, (ctx) => {
    ctx.bl642Pane = ['Should I ship BL-642?', ctx.bl642TruncatedFooter].join('\n');
    ctx.bl642Snippet = extractQuestionSnippet(ctx.bl642Pane);
  });

  scoped(registry, /^detectNeedsHuman runs on it$/, (ctx) => {
    ctx.bl642NeedsHuman = detectNeedsHuman(ctx.bl642Pane);
  });

  scoped(registry, /^the result contains none of the pane title rule, the footer, or a bare "\/rc"$/, (ctx) => {
    const s = ctx.bl642Snippet;
    if (/SwarmForge Coder/.test(s) || /─{3,}/.test(s)) {
      throw new Error(`expected no pane title rule, got: ${JSON.stringify(s)}`);
    }
    if (/bypass permissions/i.test(s) || /⏵/.test(s) || /install gh/i.test(s)) {
      throw new Error(`expected no footer furniture, got: ${JSON.stringify(s)}`);
    }
    if (/(^|\s)\/rc(\s|$)/i.test(s) || s.trim() === '/rc') {
      throw new Error(`expected no bare /rc, got: ${JSON.stringify(s)}`);
    }
  });

  scoped(registry, /^each result is the question text, unchanged$/, (ctx) => {
    const expected = [QUESTION_WITH_PERMISSIONS, QUESTION_WITH_BOX];
    if (!ctx.bl642Snippets || ctx.bl642Snippets.length !== expected.length) {
      throw new Error(`expected ${expected.length} snippets, got: ${JSON.stringify(ctx.bl642Snippets)}`);
    }
    for (let i = 0; i < expected.length; i++) {
      if (ctx.bl642Snippets[i] !== expected[i]) {
        throw new Error(
          `expected snippet[${i}] unchanged, got: ${JSON.stringify(ctx.bl642Snippets[i])} want: ${JSON.stringify(expected[i])}`
        );
      }
    }
  });

  scoped(registry, /^the result is "\(no question text captured; open the pane\)"$/, (ctx) => {
    if (ctx.bl642Snippet !== NO_QUESTION_TEXT_CAPTURED) {
      throw new Error(
        `expected ${JSON.stringify(NO_QUESTION_TEXT_CAPTURED)}, got: ${JSON.stringify(ctx.bl642Snippet)}`
      );
    }
  });

  scoped(registry, /^the result is neither a furniture string nor an empty body$/, (ctx) => {
    const s = ctx.bl642Snippet;
    if (!s || !String(s).trim()) {
      throw new Error('expected a non-empty explicit message, got empty body');
    }
    if (/SwarmForge \w+/.test(s) || /bypass permissions/i.test(s) || /⏵/.test(s) || s.trim() === '/rc') {
      throw new Error(`expected no furniture, got: ${JSON.stringify(s)}`);
    }
  });

  scoped(registry, /^the truncated footer is absent from the result$/, (ctx) => {
    const s = ctx.bl642Snippet;
    if (s.includes(ctx.bl642TruncatedFooter) || /bypass permissions/i.test(s) || /⏵/.test(s)) {
      throw new Error(`expected truncated footer absent, got: ${JSON.stringify(s)}`);
    }
    if (s !== 'Should I ship BL-642?') {
      throw new Error(`expected the real question to survive, got: ${JSON.stringify(s)}`);
    }
  });

  scoped(registry, /^it returns false, unchanged from before this fix$/, (ctx) => {
    if (ctx.bl642NeedsHuman !== false) {
      throw new Error(`expected detectNeedsHuman false, got: ${ctx.bl642NeedsHuman}`);
    }
  });
}

module.exports = { registerSteps };
