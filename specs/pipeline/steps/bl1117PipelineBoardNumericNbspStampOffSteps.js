'use strict';

// BL-1117: stamp-off of tip 646ffe85d (Pipeline Board numeric &#160;).
// Drives the REAL wrapPipelineBoardHtml / board module — does not reimplement.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1117 stamp-off of Pipeline Board numeric nbsp tip 646ffe85d';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TIP = '646ffe85d';
const NUMERIC = '&#160;';
const NAMED = '&nbsp;';

function board() {
  return require(path.join(REPO_ROOT, 'extension', 'out', 'concierge', 'pipelineBoard.js'));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a Pipeline Board stage header string that contains a U\+00A0 between DC and QA$/,
    (ctx) => {
      ctx.header = `DC\u00a0QA`;
    }
  );

  scoped(/^escapeHtml renders that string for Telegram HTML parse_mode$/, (ctx) => {
    ctx.html = board().wrapPipelineBoardHtml(ctx.header);
  });

  scoped(/^the output contains the numeric entity ampersand-hash-160-semicolon$/, (ctx) => {
    assert.ok(ctx.html.includes(NUMERIC), `missing ${NUMERIC} in ${ctx.html}`);
  });

  scoped(/^the output does not contain the named entity string &nbsp;$/, (ctx) => {
    assert.ok(!ctx.html.includes(NAMED), `named ${NAMED} must not appear`);
  });

  scoped(/^a rendered Pipeline Board HTML body with the DC and QA stage labels$/, (ctx) => {
    const NBSP = '\u00a0';
    const header = `${NBSP.repeat(4)}${NBSP}NS${NBSP}SP${NBSP}CO${NBSP}CL${NBSP}AR${NBSP}HD${NBSP}DC${NBSP}QA`;
    ctx.boardHtml = board().wrapPipelineBoardHtml(header);
  });

  scoped(/^the stage header markup is inspected$/, (ctx) => {
    assert.ok(typeof ctx.boardHtml === 'string' && ctx.boardHtml.length > 0);
  });

  scoped(/^DC and QA are separated by the numeric nbsp entity$/, (ctx) => {
    assert.match(ctx.boardHtml, /DC&#160;QA/);
    assert.ok(!ctx.boardHtml.includes(NAMED));
    // Tip reachable for review (confirm tip exists; stamp does not invent a new fix).
    const tipType = execFileSync('git', ['cat-file', '-t', TIP], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    assert.equal(tipType, 'commit', `tip ${TIP} must be a reachable commit`);
    const ledger = fs.readFileSync(path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml'), 'utf8');
    assert.match(ledger, /646ffe85d/);
    assert.match(ledger, /BL-1117/);
  });
}

module.exports = { registerSteps };
