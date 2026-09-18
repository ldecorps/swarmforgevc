'use strict';

// BL-1542: step handlers for "The live screen ticket strip can be
// collapsed to one line so the pane grid stays on a phone screen". Drives
// the REAL getResidentSpyUiHtml() shell under jsdom, same pattern
// bl609ResidentSpyFontSizeControlSteps.js and bl994LiveScreenGridSteps.js
// already use for this exact page. Windows are always closed before a
// step returns - the page registers real setInterval polls that would
// otherwise hang node --test.

const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_OUT = path.join(REPO_ROOT, 'extension', 'out');
const EXTENSION_NODE_MODULES = path.join(REPO_ROOT, 'extension', 'node_modules');

const FEATURE = 'The live screen ticket strip can be collapsed to one line so the pane grid stays on a phone screen';

const LONG_TITLE = 'A'.repeat(50) + ' ' + 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(6);

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in getResidentSpyUiHtml() output');
  }
  return match[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function panesOf({ withTicket = true } = {}) {
  const claimAt = Date.now() - 5_000;
  return [
    {
      id: 'resident',
      label: 'Resident',
      pane: {
        available: true,
        roleLabel: 'Coder',
        modelLabel: 'Sonnet',
        ticketId: withTicket ? 'BL-1542' : undefined,
        ticketTitle: withTicket ? LONG_TITLE : undefined,
        claimEnteredAtMs: withTicket ? claimAt : undefined,
        paneText: 'resident text',
      },
    },
    {
      id: 'role-1',
      label: 'Role1',
      pane: { available: true, roleLabel: 'Cleaner', modelLabel: 'Sonnet', paneText: 'role-1 text' },
    },
  ];
}

// Renders the live screen for real, mocking fetch for /resident-pane (the
// pane poll) and /web-ui-ticket-strip-collapsed (the collapse preference
// route) - never a re-implementation of either. Every field a Then step
// needs is read into a plain object before the window closes.
async function driveScreen({ withTicket = true, storedCollapsed = null, taps = [], refreshes = 0 } = {}) {
  const { getResidentSpyUiHtml } = require(path.join(EXTENSION_OUT, 'bridge', 'residentSpyUiHtml'));
  const { JSDOM } = require(path.join(EXTENSION_NODE_MODULES, 'jsdom'));

  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  try {
    let storageWrites = 0;
    const wrapStorage = (storage) => {
      if (!storage) return;
      const setItem = storage.setItem.bind(storage);
      storage.setItem = (...args) => {
        storageWrites += 1;
        return setItem(...args);
      };
    };
    wrapStorage(dom.window.localStorage);
    wrapStorage(dom.window.sessionStorage);

    let collapsedOnServer = storedCollapsed === null ? false : storedCollapsed;
    const putCalls = [];
    const panes = panesOf({ withTicket });

    dom.window.fetch = (url, opts) => {
      const u = String(url);
      if (u.indexOf('/web-ui-ticket-strip-collapsed') === 0) {
        if (opts && opts.method === 'PUT') {
          const body = JSON.parse(opts.body);
          putCalls.push(body);
          collapsedOnServer = body.collapsed;
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, ...body }) });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, surface: 'live-screen', collapsed: collapsedOnServer }),
        });
      }
      if (u.indexOf('/web-ui-font-size') === 0) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: false }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, monoRouterLayout: true, panes }),
      });
    };

    dom.window.eval(extractInlineScript(html));
    await flush();
    await flush(); // second microtask turn: the collapse-preference fetch's own .then chain

    const { document } = dom.window;
    for (const tap of taps) {
      const btn = document.getElementById('ticket-strip-collapse-btn');
      assert.ok(btn, 'missing ticket-strip-collapse-btn');
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await flush();
    }

    let metaBefore = null;
    if (refreshes > 0) {
      metaBefore = document.getElementById('ticket-strip-meta').textContent;
      for (let i = 0; i < refreshes; i += 1) {
        await wait(4100);
      }
      await flush();
    }

    const stripEl = document.getElementById('ticket-strip');
    const btnEl = document.getElementById('ticket-strip-collapse-btn');
    const fsFontCtrlEl = document.getElementById('fs-font-ctrl');
    return {
      stripHidden: stripEl.hidden,
      isCollapsed: stripEl.classList.contains('is-collapsed'),
      btnPresent: !!btnEl,
      btnVisible: btnEl ? btnEl.offsetParent !== null || !stripEl.hidden : false,
      btnIsFontCtrlChild: fsFontCtrlEl ? fsFontCtrlEl.contains(btnEl) : false,
      btnLabel: btnEl ? btnEl.getAttribute('aria-label') : null,
      idText: document.getElementById('ticket-strip-id').textContent,
      titleText: document.getElementById('ticket-strip-title').textContent,
      metaText: document.getElementById('ticket-strip-meta').textContent,
      metaBefore,
      titleComputedOverflow: dom.window.getComputedStyle(document.getElementById('ticket-strip-title')).textOverflow,
      putCalls,
      storageWrites,
      html,
    };
  } finally {
    dom.window.close();
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the live screen is open in the grid view on a rotation layout$/, (ctx) => {
    ctx.bl1542Opts = { withTicket: true };
  });

  scoped(/^the working ticket's title runs to several hundred characters$/, () => {
    assert.ok(LONG_TITLE.length > 300, 'fixture title must itself run long');
  });

  scoped(/^the ticket strip is collapsed$/, (ctx) => {
    ctx.bl1542Opts = { ...ctx.bl1542Opts, storedCollapsed: true };
  });

  scoped(/^the human collapsed the strip on an earlier visit$/, (ctx) => {
    ctx.bl1542Opts = { ...ctx.bl1542Opts, storedCollapsed: true };
  });

  scoped(/^the pane data carries no working ticket$/, async (ctx) => {
    ctx.bl1542Opts = { ...ctx.bl1542Opts, withTicket: false };
    ctx.bl1542 = await driveScreen(ctx.bl1542Opts);
  });

  scoped(/^the live screen first renders$/, async (ctx) => {
    ctx.bl1542 = await driveScreen(ctx.bl1542Opts || {});
  });

  scoped(/^the human taps the collapse control$/, async (ctx) => {
    const priorTaps = ctx.bl1542Taps || [];
    ctx.bl1542Taps = [...priorTaps, 1];
    ctx.bl1542 = await driveScreen({ ...ctx.bl1542Opts, taps: ctx.bl1542Taps });
  });

  scoped(/^the live screen loads again$/, async (ctx) => {
    ctx.bl1542 = await driveScreen(ctx.bl1542Opts || {});
  });

  scoped(/^the live screen refreshes its pane data twice$/, async (ctx) => {
    ctx.bl1542 = await driveScreen({ ...ctx.bl1542Opts, refreshes: 2 });
  });

  scoped(/^the ticket strip shows a collapse control$/, (ctx) => {
    assert.ok(ctx.bl1542.btnPresent, 'expected #ticket-strip-collapse-btn to exist');
    assert.equal(ctx.bl1542.stripHidden, false);
  });

  scoped(/^the collapse control is a different control from the pane text-size control$/, (ctx) => {
    assert.equal(ctx.bl1542.btnIsFontCtrlChild, false, 'the collapse control must not live inside #fs-font-ctrl');
  });

  scoped(/^the ticket id, the full title and the role, model and claim-age line are all shown$/, (ctx) => {
    assert.match(ctx.bl1542.idText, /BL-1542/);
    assert.equal(ctx.bl1542.titleText, LONG_TITLE);
    assert.equal(ctx.bl1542.isCollapsed, false);
    assert.match(ctx.bl1542.metaText, /Coder/);
  });

  scoped(/^the ticket title is shown on a single ellipsized line$/, (ctx) => {
    assert.equal(ctx.bl1542.isCollapsed, true);
    assert.match(ctx.bl1542.html, /\.ticket-strip\.is-collapsed \.ticket-strip-title[\s\S]*?text-overflow:\s*ellipsis/);
  });

  scoped(/^the ticket id and the role, model and claim-age line are still shown$/, (ctx) => {
    assert.match(ctx.bl1542.idText, /BL-1542/);
    assert.match(ctx.bl1542.metaText, /Coder/);
  });

  scoped(/^the collapse control now offers to expand$/, (ctx) => {
    assert.match(ctx.bl1542.btnLabel, /expand/i);
  });

  scoped(/^the full ticket title is shown again$/, (ctx) => {
    assert.equal(ctx.bl1542.isCollapsed, false);
    assert.equal(ctx.bl1542.titleText, LONG_TITLE);
  });

  scoped(/^the collapse control offers to collapse$/, (ctx) => {
    assert.match(ctx.bl1542.btnLabel, /collapse/i);
  });

  scoped(/^the ticket strip is still collapsed$/, (ctx) => {
    assert.equal(ctx.bl1542.isCollapsed, true);
  });

  scoped(/^the claim age in the strip has been updated$/, (ctx) => {
    assert.notEqual(ctx.bl1542.metaText, ctx.bl1542.metaBefore, 'expected the claim-age text to change after two refreshes');
  });

  scoped(/^the ticket strip renders collapsed$/, (ctx) => {
    assert.equal(ctx.bl1542.isCollapsed, true);
  });

  scoped(/^no browser storage was written$/, (ctx) => {
    assert.equal(ctx.bl1542.storageWrites, 0);
    assert.doesNotMatch(ctx.bl1542.html, /localStorage|sessionStorage/);
  });

  scoped(/^the ticket strip is hidden$/, (ctx) => {
    assert.equal(ctx.bl1542.stripHidden, true);
  });

  scoped(/^no collapse control is shown on its own$/, (ctx) => {
    assert.equal(ctx.bl1542.btnVisible, false, 'the collapse control must be hidden along with its hidden parent strip');
  });
}

module.exports = { registerSteps };
