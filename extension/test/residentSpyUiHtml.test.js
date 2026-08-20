const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { getResidentSpyUiHtml } = require('../out/bridge/residentSpyUiHtml');

// BL-929: locked human decision 1 - the top #ticket-strip must not show
// when the live layout is standing-fleet (full-forge/seven-pack/any
// non-rotation pack). Same jsdom + runScripts:'outside-only' + manual
// window.eval(extractInlineScript(...)) pattern pausedPagerUiHtml.test.js
// already established for this project's bridge UI pages - never a
// hand-rolled reimplementation of the client-side gating logic.

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

function pane(overrides = {}) {
  return { available: true, roleLabel: 'Documenter', modelLabel: 'Sonnet 5', ...overrides };
}

function renderScreen(fetchImpl) {
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.fetch = (url, opts) => fetchImpl(url, opts);
  window.eval(extractInlineScript(html));
  return dom;
}

function residentPaneResponse(data) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

test('BL-929: the top ticket strip is not shown under a standing full pack, even with a ticket-holding tile', async () => {
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: false,
      panes: [
        { id: 'coordinator', label: 'Coordinator', pane: pane({ roleLabel: 'Coordinator' }) },
        {
          id: 'documenter',
          label: 'Documenter',
          pane: pane({ ticketId: 'BL-640', ticketTitle: 'Some ticket', roleLabel: 'Documenter' }),
        },
      ],
    })
  );
  await flush();
  const { document } = dom.window;
  assert.equal(document.getElementById('ticket-strip').hidden, true);
  // BL-994 locked decision 2: a grid tile carries the role name and an
  // Expand control ONLY - ticket metadata (and the transcript) moved to the
  // fullscreen Expand view, not the tile head. This assertion pinned the
  // PRE-BL-994 behavior (ticket id inline in the tile head). BL-994's own
  // "Expand still opens the full metadata and transcript" test
  // (bl994LiveScreenGrid.test.js) uses ticketless fixtures and does not
  // cover the RELOCATED ticket line; that positive assertion lives in
  // BL-929's own amended acceptance scenario 03 (fabecba4c) instead -
  // specs/pipeline/steps/bl929LiveScreenPackLayoutSteps.js's "the
  // documenter tile shows that ticket in its Expand view" step.
  const documenterHead = document.querySelector('.pane-col[data-pane-id="documenter"] .pane-head');
  assert.doesNotMatch(documenterHead.innerHTML, /BL-640/);
  assert.match(documenterHead.innerHTML, /Documenter/);
});

test('BL-929: no tile is labelled Resident under a standing full pack', async () => {
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: false,
      panes: [
        { id: 'coordinator', label: 'Coordinator', pane: pane({ roleLabel: 'Coordinator' }) },
        { id: 'coder', label: 'Coder', pane: pane({ roleLabel: 'Coder' }) },
      ],
    })
  );
  await flush();
  const { document } = dom.window;
  assert.equal(document.querySelector('.pane-col[data-pane-id="resident"]'), null);
  const coderHead = document.querySelector('.pane-col[data-pane-id="coder"] .pane-head');
  assert.doesNotMatch(coderHead.innerHTML, /Resident/);
});

test('the top ticket strip is shown under a mono-router (rotation) pack with a ticket-holding resident', async () => {
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: true,
      resident: pane({ ticketId: 'BL-529', ticketTitle: 'Ticket branch guard', roleLabel: 'Coder' }),
      coordinator: pane({ roleLabel: 'Coordinator' }),
      panes: [
        {
          id: 'resident',
          label: 'Resident',
          pane: pane({ ticketId: 'BL-529', ticketTitle: 'Ticket branch guard', roleLabel: 'Coder' }),
        },
        { id: 'coordinator', label: 'Coordinator', pane: pane({ roleLabel: 'Coordinator' }) },
      ],
    })
  );
  await flush();
  const { document } = dom.window;
  assert.equal(document.getElementById('ticket-strip').hidden, false);
  assert.equal(document.getElementById('ticket-strip-id').textContent, 'BL-529');
});

test('BL-929: the strip stays hidden before the first snapshot names a layout (fails closed)', async () => {
  // No fetch has resolved yet - lastMonoRouterLayout must default to false
  // (hide), never true, so a standing pack never shows the strip even for
  // one frame before the first poll lands.
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  dom.window.fetch = () => new Promise(() => {}); // never resolves
  dom.window.eval(extractInlineScript(html));
  assert.equal(dom.window.document.getElementById('ticket-strip').hidden, true);
});
