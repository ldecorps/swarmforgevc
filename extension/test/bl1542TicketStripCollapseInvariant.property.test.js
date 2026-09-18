'use strict';

// BL-1542 declared invariant (property authorship rests with the coder,
// first pass - BL-654): "The strip's collapsed or expanded state changes
// only on a human tap or on loading a stored preference - never on a
// pane-data refresh, a claim-age tick, or a layout re-check."
//
// The acceptance feature's scenario 04 proves the refresh/tick half of
// this with two REAL 4-second poll cycles against the real page (a
// single, fixed case). This property test covers the OTHER half generatively
// against the same real page under jsdom: for any number of taps on the
// real collapse control, starting from any stored preference, the final
// collapsed state is EXACTLY determined by the loaded preference and the
// tap count's parity - nothing else ever moves it, over many generated
// combinations rather than one fixed tap count.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');

const EXTENSION_OUT = path.join(__dirname, '..', 'out');
const EXTENSION_NODE_MODULES = path.join(__dirname, '..', 'node_modules');

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

function onePane(withTicket) {
  return [
    {
      id: 'resident',
      label: 'Resident',
      pane: {
        available: true,
        roleLabel: 'Coder',
        modelLabel: 'Sonnet',
        ticketId: withTicket ? 'BL-1542' : undefined,
        ticketTitle: withTicket ? 'a very long title '.repeat(20) : undefined,
        claimEnteredAtMs: withTicket ? Date.now() - 1000 : undefined,
        paneText: 'resident text',
      },
    },
  ];
}

// Real page, real DOM click dispatches, real load of the (mocked) stored
// preference - never a re-implementation of the toggle logic.
async function finalCollapsedAfter(initialStored, tapCount) {
  const { getResidentSpyUiHtml } = require(path.join(EXTENSION_OUT, 'bridge', 'residentSpyUiHtml'));
  const { JSDOM } = require(path.join(EXTENSION_NODE_MODULES, 'jsdom'));

  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  try {
    const panes = onePane(true);
    dom.window.fetch = (url) => {
      const u = String(url);
      if (u.indexOf('/web-ui-ticket-strip-collapsed') === 0) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, surface: 'live-screen', collapsed: initialStored }),
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
    await flush();

    const { document } = dom.window;
    const btn = document.getElementById('ticket-strip-collapse-btn');
    for (let i = 0; i < tapCount; i += 1) {
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await flush();
    }
    return document.getElementById('ticket-strip').classList.contains('is-collapsed');
  } finally {
    dom.window.close();
  }
}

test('BL-1542/BL-654 invariant: final collapsed state is exactly the loaded preference XOR the tap count parity', async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), fc.integer({ min: 0, max: 5 }), async (initialStored, tapCount) => {
      const actual = await finalCollapsedAfter(initialStored, tapCount);
      const expected = tapCount % 2 === 0 ? initialStored : !initialStored;
      assert.equal(
        actual,
        expected,
        `initialStored=${initialStored} tapCount=${tapCount}: expected ${expected}, got ${actual}`
      );
    }),
    { numRuns: 12 }
  );
});

// Non-vacuity (staged-first restore, run 2026-09-18, recorded in the
// parcel commit): break - the click handler's toggle line changed from
// `ticketStripCollapsed = !ticketStripCollapsed` to unconditionally
// `ticketStripCollapsed = true`. The property failed on its very first
// generated case, seed 1237194375, counterexample [initialStored=true,
// tapCount=1]: expected false (one toggle from an already-collapsed
// strip should expand it), got true (the broken handler forces collapsed
// regardless). Restored byte-for-byte, the property holds again.
