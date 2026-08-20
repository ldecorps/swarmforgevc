'use strict';

// BL-994 declared invariant 3 (property authorship rests with the coder,
// first pass - BL-654): "A pane's transcript lives in exactly one place -
// hidden in the grid tile, shown in the fullscreen Expand. Never both,
// never neither." Sweeps random pane counts (the full 1-8 range the Live
// Screen supports) and a randomly chosen tile to expand, driving the REAL
// rendered page (jsdom + the compiled client script - the same
// runScripts:'outside-only' harness bl994LiveScreenGrid.test.js's own
// "Expand still opens..." scenario uses) rather than a hand-derived model
// of the exclusivity rule.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { JSDOM } = require('jsdom');
const { getResidentSpyUiHtml } = require('../out/bridge/residentSpyUiHtml');

function extractInlineScript(html) {
  return html.match(/<script>([\s\S]*?)<\/script>/)[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function panesOf(n) {
  const roles = ['Coordinator', 'Specifier', 'Coder', 'Cleaner', 'Architect', 'Hardener', 'Documenter', 'Qa'];
  return roles.slice(0, n).map((role) => ({
    id: role.toLowerCase(),
    label: role,
    pane: { available: true, roleLabel: role, modelLabel: 'Sonnet 5', paneText: `${role} live output` },
  }));
}

function residentPaneResponse(data) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}

async function renderWithPanes(n) {
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  const panes = panesOf(n);
  dom.window.fetch = () => residentPaneResponse({ available: true, monoRouterLayout: false, panes });
  dom.window.eval(extractInlineScript(html));
  await flush();
  return { dom, panes };
}

function transcriptVisibleInGrid(dom, paneId) {
  const pre = dom.window.document.querySelector(`.pane-col[data-pane-id="${paneId}"] pre`);
  return dom.window.getComputedStyle(pre).display !== 'none';
}

function transcriptVisibleInFullscreen(dom, paneText) {
  const active = dom.window.document.body.classList.contains('pane-fullscreen-active');
  if (!active) {
    return false;
  }
  return dom.window.document.getElementById('fs-pre').textContent === paneText;
}

test('BL-994/BL-654 invariant 3: a transcript is visible in exactly one place - grid or fullscreen, never both, never neither', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 7 }), async (paneCount, pickSeed) => {
      const { dom, panes } = await renderWithPanes(paneCount);
      const target = panes[pickSeed % panes.length];

      // Not yet expanded: hidden in grid, absent from fullscreen.
      assert.equal(transcriptVisibleInGrid(dom, target.id), false, 'not-expanded: grid must stay hidden');
      assert.equal(transcriptVisibleInFullscreen(dom, target.pane.paneText), false, 'not-expanded: fullscreen must not show it yet');

      const col = dom.window.document.querySelector(`.pane-col[data-pane-id="${target.id}"]`);
      col.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await flush();

      // Expanded: still hidden in grid, now shown in fullscreen - exactly one
      // place (inGrid=false, inFullscreen=true is itself the XOR - a third
      // possibility, both false or both true, would fail one of these two).
      const inGrid = transcriptVisibleInGrid(dom, target.id);
      const inFullscreen = transcriptVisibleInFullscreen(dom, target.pane.paneText);
      assert.equal(inGrid, false, 'expanded: the grid tile must still hide the transcript');
      assert.equal(inFullscreen, true, 'expanded: fullscreen must show this pane\'s transcript');
    }),
    { numRuns: 30 }
  );
});

// Non-vacuity (staged-first restore, run 2026-08-20, recorded in the parcel
// commit): break 1 - the grid `.split .pane-col > pre { display: none }`
// rule removed - RED (grid now shows it too, "never both" violated). break
// 2 - enterFullscreen's body-class toggle disabled - RED (fullscreen no
// longer shows it, "never neither" violated). Both restored, ALL
// PROPERTIES HOLD.
