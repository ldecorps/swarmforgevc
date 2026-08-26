'use strict';

// BL-609: Resident Spy live-screen font-size control. Drives the REAL
// getResidentSpyUiHtml() shell under jsdom. Windows are always closed before
// a step returns — the page registers setInterval polls that would otherwise
// hang node --test (same lesson as bl994LiveScreenGridSteps.js).

const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'jsdom'));
const {
  PANE_FONT_DEFAULT_PX,
  PANE_FONT_MAX_PX,
  PANE_FONT_MIN_PX,
} = require('../../../extension/out/bridge/residentSpyPaneFontSize');
const { getResidentSpyUiHtml } = require('../../../extension/out/bridge/residentSpyUiHtml');

const FEATURE = 'The Resident Spy live screen offers a compact font size control in its header';

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

function panesOf(count) {
  const claimAt = Date.now() - 125_000;
  const panes = [];
  for (let i = 0; i < count; i += 1) {
    panes.push({
      id: i === 0 ? 'resident' : `role-${i}`,
      label: i === 0 ? 'Resident' : `Role${i}`,
      pane: {
        available: true,
        roleLabel: i === 0 ? 'Resident' : `Role${i}`,
        modelLabel: 'Sonnet',
        ticketId: i === 0 ? 'BL-609' : undefined,
        ticketTitle: i === 0 ? 'font size control' : undefined,
        claimEnteredAtMs: i === 0 ? claimAt : undefined,
        paneText: `pane-${i} text`,
      },
    });
  }
  return panes;
}

async function driveScreen({ paneCount, taps, expand }) {
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  let storageWrites = 0;
  try {
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
    const panes = panesOf(paneCount);
    dom.window.fetch = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, monoRouterLayout: true, panes }),
      });
    dom.window.eval(extractInlineScript(html));
    await flush();

    const { document } = dom.window;
    if (expand) {
      const col = document.querySelector('.pane-col[data-pane-id="resident"]');
      assert.ok(col, 'expected a resident tile');
      col.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    }

    for (const tap of taps || []) {
      const id = tap === 'increase' ? 'fs-font-inc' : 'fs-font-dec';
      const btn = document.getElementById(id);
      assert.ok(btn, `missing ${id}`);
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    }

    const fontPx = document.documentElement.style.getPropertyValue('--pane-font-size').trim();
    const inc = document.getElementById('fs-font-inc');
    const dec = document.getElementById('fs-font-dec');
    const headText = document.getElementById('fs-head') ? document.getElementById('fs-head').textContent : '';
    const ctrlFontMatch = html.match(/\.fs-font-ctrl button\s*\{[^}]*font-size:\s*(\d+)px/);
    return {
      html,
      fontPx,
      paneCount: document.querySelectorAll('.pane-col').length,
      splitClass: document.getElementById('pane-split').className,
      headText,
      incUnavailable: !!(inc && inc.disabled && inc.classList.contains('is-unavailable')),
      decUnavailable: !!(dec && dec.disabled && dec.classList.contains('is-unavailable')),
      ctrlFontPx: ctrlFontMatch ? Number(ctrlFontMatch[1]) : null,
      storageWrites,
      hasFsPre: !!document.getElementById('fs-pre'),
    };
  } finally {
    dom.window.close();
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the Resident Spy live screen is open on a pane$/, (ctx) => {
    ctx.bl609PaneCount = ctx.bl609PaneCount || 1;
  });

  scoped(/^the live screen first renders$/, async (ctx) => {
    ctx.bl609 = await driveScreen({ paneCount: ctx.bl609PaneCount || 1, taps: [], expand: true });
  });

  scoped(/^the pane output text renders at the new larger default size$/, (ctx) => {
    assert.equal(ctx.bl609.fontPx, `${PANE_FONT_DEFAULT_PX}px`);
    assert.ok(PANE_FONT_DEFAULT_PX > 11);
  });

  scoped(/^the human taps the (increase|decrease) control$/, async (ctx, control) => {
    const prior = ctx.bl609TapPlan || [];
    ctx.bl609TapPlan = [...prior, control];
    ctx.bl609 = await driveScreen({
      paneCount: ctx.bl609PaneCount || 1,
      taps: ctx.bl609TapPlan,
      expand: true,
    });
  });

  scoped(/^the pane output text renders one step larger$/, (ctx) => {
    assert.equal(ctx.bl609.fontPx, `${PANE_FONT_DEFAULT_PX + 1}px`);
  });

  scoped(/^the pane output text renders back at the previous size$/, (ctx) => {
    assert.equal(ctx.bl609.fontPx, `${PANE_FONT_DEFAULT_PX}px`);
  });

  scoped(/^the pane text size is already at its (minimum|maximum) bound$/, async (ctx, bound) => {
    const taps = [];
    const count = PANE_FONT_MAX_PX - PANE_FONT_MIN_PX + 5;
    for (let i = 0; i < count; i += 1) {
      taps.push(bound === 'maximum' ? 'increase' : 'decrease');
    }
    ctx.bl609Bound = bound;
    ctx.bl609TapPlan = taps;
    ctx.bl609 = await driveScreen({ paneCount: 1, taps, expand: true });
    const expected = bound === 'maximum' ? PANE_FONT_MAX_PX : PANE_FONT_MIN_PX;
    assert.equal(ctx.bl609.fontPx, `${expected}px`);
  });

  scoped(/^the pane output text size is unchanged$/, (ctx) => {
    const expected = ctx.bl609Bound === 'maximum' ? PANE_FONT_MAX_PX : PANE_FONT_MIN_PX;
    assert.equal(ctx.bl609.fontPx, `${expected}px`);
  });

  scoped(/^the (increase|decrease) control is shown as unavailable$/, (ctx, control) => {
    if (control === 'increase') {
      assert.equal(ctx.bl609.incUnavailable, true);
    } else {
      assert.equal(ctx.bl609.decUnavailable, true);
    }
  });

  scoped(
    /^the header still shows the ticket id and title, the role, the model, how long ago the pane entered its claim, and the resident badge$/,
    (ctx) => {
      const head = ctx.bl609.headText;
      assert.match(head, /BL-609/);
      assert.match(head, /font size control/);
      assert.match(head, /Resident/);
      assert.match(head, /Sonnet/);
      assert.match(head, /entered/);
    }
  );

  scoped(/^the size control renders smaller than the pane output text$/, (ctx) => {
    assert.ok(ctx.bl609.ctrlFontPx !== null && ctx.bl609.ctrlFontPx < PANE_FONT_DEFAULT_PX);
    assert.match(ctx.bl609.html, /--pane-font-size:\s*13px/);
  });

  scoped(/^several panes are shown in the grid view$/, (ctx) => {
    ctx.bl609PaneCount = 8;
  });

  scoped(/^the human increases the pane text size$/, async (ctx) => {
    ctx.bl609TapPlan = ['increase'];
    ctx.bl609 = await driveScreen({
      paneCount: ctx.bl609PaneCount || 8,
      taps: ['increase'],
      expand: true,
    });
  });

  scoped(/^every grid tile renders at the increased size$/, (ctx) => {
    assert.equal(ctx.bl609.paneCount, ctx.bl609PaneCount || 8);
    assert.equal(ctx.bl609.fontPx, `${PANE_FONT_DEFAULT_PX + 1}px`);
    assert.match(ctx.bl609.html, /font-size:\s*var\(--pane-font-size\)/);
  });

  scoped(/^the fullscreen pane renders at the increased size$/, (ctx) => {
    assert.equal(ctx.bl609.fontPx, `${PANE_FONT_DEFAULT_PX + 1}px`);
    assert.equal(ctx.bl609.hasFsPre, true);
  });

  scoped(/^a crowded grid still renders its tiles a fixed step smaller than the chosen size$/, (ctx) => {
    assert.match(ctx.bl609.html, /\.split\.pane-count-7 pre[\s\S]*?calc\(var\(--pane-font-size\)\s*-\s*2px\)/);
    assert.match(ctx.bl609.html, /\.split\.pane-count-8 pre[\s\S]*?calc\(var\(--pane-font-size\)\s*-\s*2px\)/);
  });

  scoped(/^the human changes the pane text size$/, async (ctx) => {
    ctx.bl609 = await driveScreen({ paneCount: 1, taps: ['increase'], expand: true });
  });

  scoped(/^no browser storage is written$/, (ctx) => {
    assert.equal(ctx.bl609.storageWrites, 0);
    assert.doesNotMatch(ctx.bl609.html, /localStorage|sessionStorage/);
  });
}

module.exports = { registerSteps };
