'use strict';

// BL-1947 (BL-662 stamp-off): step handlers for "the paused pager screen
// shows the server's failure reason, not a bare HTTP status". Drives the
// REAL getPausedPagerUiHtml() output in jsdom with a stubbed fetch/confirm
// (mirrors bl609ResidentSpyFontSizeControlSteps.js's own established
// pattern), dispatching real onclick handlers - never a restatement of the
// reasonOrFallback logic.

const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const JSDOM_MODULE = path.join(EXT_DIR, 'node_modules', 'jsdom');

let _pausedPagerModule = null;
function pausedPagerModule() {
  if (!_pausedPagerModule) _pausedPagerModule = require(path.join(EXT_DIR, 'out', 'bridge', 'pausedPagerUiHtml.js'));
  return _pausedPagerModule;
}

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in getPausedPagerUiHtml() output');
  }
  return match[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function item(id) {
  return { id, title: id + ' title', priority: 4, canExpedite: true, canApprove: true, needsApproval: true };
}

function stateResponse(items) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ items, total: items.length }) });
}

function renderScreen(fetchImpl) {
  const { JSDOM } = require(JSDOM_MODULE);
  const html = pausedPagerModule().getPausedPagerUiHtml();
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/paused/', pretendToBeVisual: true });
  dom.window.confirm = () => true;
  dom.window.fetch = (url, opts) => fetchImpl(url, opts);
  dom.window.eval(extractInlineScript(html));
  return dom;
}

const FEATURE = "the paused pager screen shows the server's failure reason, not a bare HTTP status";

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  function nonOkFixture(action, { status, body, unparseable }) {
    return renderScreen((url) => {
      if (String(url).startsWith('/paused-pager-state')) {
        return stateResponse([item('BL-662-fixture')]);
      }
      if (String(url).startsWith(`/paused-pager/${action}`)) {
        return Promise.resolve({
          ok: false,
          status,
          json: () => (unparseable ? Promise.reject(new Error('bad json')) : Promise.resolve(body)),
        });
      }
      return Promise.reject(new Error('unexpected fetch: ' + url));
    });
  }

  async function clickAndSettle(dom, buttonId) {
    await flush();
    dom.window.document.getElementById(buttonId).onclick();
    await flush();
    await flush();
  }

  // ── non-ok-response-with-reason-shows-reason-01 ────────────────────────
  scoped(
    /^the bridge responds to a paused-pager action with a non-OK status and a JSON body containing "reason": "ticket not found in active\/paused"$/,
    async (ctx) => {
      ctx.dom = nonOkFixture('expedite', { status: 404, body: { success: false, reason: 'ticket not found in active/paused' } });
      await clickAndSettle(ctx.dom, 'expedite');
    }
  );

  scoped(/^the paused pager renders the response$/, () => {
    // Already rendered by the Given step's own click+settle above.
  });

  scoped(/^the status line shows "ticket not found in active\/paused"$/, (ctx) => {
    assert.equal(ctx.dom.window.document.getElementById('status').textContent, 'ticket not found in active/paused');
  });

  scoped(/^the status line does not show a bare "HTTP 404" with no reason text$/, (ctx) => {
    assert.equal(ctx.dom.window.document.getElementById('status').textContent.includes('HTTP 404'), false);
  });

  // ── non-ok-response-without-reason-falls-back-02 ───────────────────────
  scoped(/^the bridge responds to a paused-pager action with a non-OK status and a body containing no "reason" field$/, async (ctx) => {
    ctx.expectedFallbackStatus = 500;
    ctx.dom = nonOkFixture('expedite', { status: ctx.expectedFallbackStatus, body: { success: false } });
    await clickAndSettle(ctx.dom, 'expedite');
  });

  scoped(/^the status line shows the configured failText followed by the HTTP status$/, (ctx) => {
    assert.equal(ctx.dom.window.document.getElementById('status').textContent, `Expedite failed (HTTP ${ctx.expectedFallbackStatus})`);
  });

  // ── non-ok-response-with-unparseable-body-falls-back-03 ────────────────
  scoped(/^the bridge responds to a paused-pager action with a non-OK status and a body that fails to parse as JSON$/, async (ctx) => {
    ctx.expectedFallbackStatus = 502;
    ctx.dom = nonOkFixture('expedite', { status: ctx.expectedFallbackStatus, unparseable: true });
    await clickAndSettle(ctx.dom, 'expedite');
  });

  // ── every-status-line-writer-in-the-file-covered-04 (outline) ─────────
  const ACTION_TO_BUTTON = { expedite: 'expedite', approve: 'approve' };
  const ACTION_TO_FAILTEXT_SCENARIO_REASON = {
    expedite: { status: 404, reason: 'ticket not found in active/paused' },
    approve: { status: 403, reason: 'not pending approval' },
  };

  scoped(/^"(expedite|approve)" responds non-OK with a JSON body containing a reason$/, async (ctx, action) => {
    const { status, reason } = ACTION_TO_FAILTEXT_SCENARIO_REASON[action];
    ctx.outlineAction = action;
    ctx.dom = nonOkFixture(action, { status, body: { success: false, reason } });
    ctx.expectedOutlineReason = reason;
  });

  scoped(/^the paused pager renders the response for "(expedite|approve)"$/, async (ctx, action) => {
    await clickAndSettle(ctx.dom, ACTION_TO_BUTTON[action]);
  });

  scoped(/^the status line shows the server-sent reason$/, (ctx) => {
    assert.equal(ctx.dom.window.document.getElementById('status').textContent, ctx.expectedOutlineReason);
  });
}

module.exports = { registerSteps };
