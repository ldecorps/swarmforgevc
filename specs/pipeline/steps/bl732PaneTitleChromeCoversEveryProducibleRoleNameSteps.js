'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE =
  'every pane title the launcher can produce is recognized as chrome';
const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  extractQuestionSnippet,
  displayNameForRole,
  NO_QUESTION_TEXT_CAPTURED,
} = require(path.join(EXT_OUT, 'panel', 'needsHumanDetection'));

const QUESTION = 'Should I ship BL-732?';

function ensure(ctx) {
  if (!ctx.bl732) ctx.bl732 = {};
  return ctx.bl732;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a captured pane awaiting a needs-human decision$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the launcher configures a role named "(.+)"$/, (ctx, role) => {
    ensure(ctx).role = role;
    ensure(ctx).display = displayNameForRole(role);
  });

  scoped(/^the pane's first line is that role's box-drawing pane-title rule$/, (ctx) => {
    const st = ensure(ctx);
    st.rule = `${'─'.repeat(24)} SwarmForge ${st.display} ──`;
    st.pane = [st.rule, QUESTION].join('\n');
  });

  scoped(/^the pane's first line is a box-drawing rule reading "(.+)"$/, (ctx, text) => {
    ensure(ctx).pane = [`${'─'.repeat(10)} ${text} ──`, QUESTION].join('\n');
    ensure(ctx).keptText = text;
  });

  scoped(/^every captured line is chrome, including a "coder@sonnet2" pane-title rule$/, (ctx) => {
    const display = displayNameForRole('coder@sonnet2');
    ensure(ctx).pane = [
      `${'─'.repeat(24)} SwarmForge ${display} ──`,
      '⏵ bypass permissions on (shift+tab to cycle)',
      '/rc',
    ].join('\n');
  });

  scoped(/^the captured text is filtered for needs-human display$/, (ctx) => {
    ensure(ctx).snippet = extractQuestionSnippet(ensure(ctx).pane);
  });

  scoped(/^the pane-title rule line is dropped as chrome$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.snippet, QUESTION);
    assert.doesNotMatch(st.snippet, /SwarmForge/);
    assert.doesNotMatch(st.snippet, new RegExp(st.display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  scoped(/^that line is kept in the captured question text$/, (ctx) => {
    assert.match(ensure(ctx).snippet, new RegExp(ensure(ctx).keptText));
  });

  scoped(/^the captured question text is the no-question-captured placeholder$/, (ctx) => {
    assert.equal(ensure(ctx).snippet, NO_QUESTION_TEXT_CAPTURED);
  });
}

module.exports = { registerSteps };
