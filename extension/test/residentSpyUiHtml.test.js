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

function makeFontFetch(store = {}) {
  return (url, opts) => {
    const href = String(url);
    if (href.startsWith('/web-ui-font-size') && (!opts || opts.method !== 'PUT')) {
      const surface = new URL(href, 'https://example.test').searchParams.get('surface');
      const fontSizePx = store[surface];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, surface, fontSizePx }),
      });
    }
    if (href.startsWith('/web-ui-font-size') && opts && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      store[body.surface] = body.fontSizePx;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, surface: body.surface, fontSizePx: body.fontSizePx }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + href));
  };
}

function renderScreen(fetchImpl, fontStore = {}) {
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const fontFetch = makeFontFetch(fontStore);
  window.fetch = (url, opts) => {
    const href = String(url);
    if (href.startsWith('/web-ui-font-size')) {
      return fontFetch(url, opts);
    }
    return fetchImpl(url, opts);
  };
  window.eval(extractInlineScript(html));
  dom.fontStore = fontStore;
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
  // BL-1046: held tickets surface on the grid tile from the same payload
  // fields as fullscreen Expand; BL-929 still forbids the global top strip
  // under a standing full pack.
  const documenterHead = document.querySelector('.pane-col[data-pane-id="documenter"] .pane-head');
  assert.match(documenterHead.innerHTML, /BL-640/);
  assert.match(documenterHead.innerHTML, /Documenter/);
  document.querySelector('.pane-col[data-pane-id="documenter"]').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true })
  );
  assert.match(document.getElementById('fs-head').textContent, /BL-640/);
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

// ── BL-609: pane font-size control ───────────────────────────────────────

test('BL-609: default pane font size is 13px via --pane-font-size (was 11px)', () => {
  const html = getResidentSpyUiHtml();
  assert.match(html, /--pane-font-size:\s*13px/);
  assert.match(html, /font-size:\s*var\(--pane-font-size\)/);
  assert.doesNotMatch(html.replace(/\/\*[\s\S]*?\*\//g, ''), /pre\s*\{[^}]*font-size:\s*11px/);
});

test('BL-609: crowded-grid pre rule is a relative step below the chosen size', () => {
  const html = getResidentSpyUiHtml();
  assert.match(
    html,
    /\.split\.pane-count-7 pre[\s\S]*?font-size:\s*calc\(var\(--pane-font-size\)\s*-\s*2px\)/
  );
});

test('BL-609: +/- control lives outside #fs-head and survives a fullscreen refresh', async () => {
  const claimAt = Date.now() - 90_000;
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: true,
      panes: [
        {
          id: 'resident',
          label: 'Resident',
          pane: pane({
            ticketId: 'BL-609',
            ticketTitle: 'font size',
            roleLabel: 'Resident',
            modelLabel: 'Sonnet',
            claimEnteredAtMs: claimAt,
            paneText: 'hello pane',
          }),
        },
      ],
    })
  );
  await flush();
  const { document } = dom.window;
  document.querySelector('.pane-col[data-pane-id="resident"]').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true })
  );
  assert.equal(document.getElementById('fs-head').contains(document.getElementById('fs-font-ctrl')), false);
  document.getElementById('fs-font-inc').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.documentElement.style.getPropertyValue('--pane-font-size').trim(), '14px');
  document.querySelector('.pane-col[data-pane-id="resident"]').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true })
  );
  assert.ok(document.getElementById('fs-font-ctrl'));
  assert.equal(document.documentElement.style.getPropertyValue('--pane-font-size').trim(), '14px');
  assert.match(document.getElementById('fs-head').textContent, /BL-609/);
  assert.match(document.getElementById('fs-head').textContent, /font size/);
  assert.match(document.getElementById('fs-head').textContent, /Resident/);
  assert.match(document.getElementById('fs-head').textContent, /Sonnet/);
  assert.match(document.getElementById('fs-head').textContent, /entered/);
});

test('BL-609: at the maximum bound the increase control is shown unavailable', async () => {
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: true,
      panes: [{ id: 'resident', label: 'Resident', pane: pane({ paneText: 'x' }) }],
    })
  );
  await flush();
  const { document } = dom.window;
  document.querySelector('.pane-col[data-pane-id="resident"]').dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true })
  );
  const inc = document.getElementById('fs-font-inc');
  for (let i = 0; i < 20; i += 1) {
    inc.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  }
  assert.equal(document.documentElement.style.getPropertyValue('--pane-font-size').trim(), '20px');
  assert.equal(inc.disabled, true);
  assert.ok(inc.classList.contains('is-unavailable'));
});

test('BL-609: the HTML shell never references browser storage', () => {
  const html = getResidentSpyUiHtml();
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
});

test('BL-1153: Live Screen pane font size survives a full Mini App reload', async () => {
  const fontStore = { 'live-screen': 16 };
  const dom = renderScreen(
    () =>
      residentPaneResponse({
        available: true,
        monoRouterLayout: true,
        panes: [{ id: 'resident', label: 'Resident', pane: pane({ paneText: 'hello pane' }) }],
      }),
    fontStore
  );
  await flush();
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--pane-font-size').trim(), '16px');
  dom.window.close();

  const reloaded = renderScreen(
    () =>
      residentPaneResponse({
        available: true,
        monoRouterLayout: true,
        panes: [{ id: 'resident', label: 'Resident', pane: pane({ paneText: 'hello pane' }) }],
      }),
    fontStore
  );
  await flush();
  assert.equal(reloaded.window.document.documentElement.style.getPropertyValue('--pane-font-size').trim(), '16px');
  assert.notEqual(
    reloaded.window.document.documentElement.style.getPropertyValue('--pane-font-size').trim(),
    '13px'
  );
});

test('BL-1046: grid tile shows held ticket id, slug, and compact claim age from payload', async () => {
  const claimAt = Date.now() - 32 * 60 * 1000;
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: false,
      panes: [
        {
          id: 'hardender',
          label: 'Hardender',
          pane: pane({
            roleLabel: 'Hardender',
            ticketId: 'BL-1035',
            ticketTitle: 'a respawned front desk bot is declared stalled two seconds after it starts',
            claimEnteredAtMs: claimAt,
          }),
        },
      ],
    })
  );
  await flush();
  const col = dom.window.document.querySelector('.pane-col[data-pane-id="hardender"]');
  assert.equal(col.querySelector('.pane-grid-ticket-id')?.textContent, 'BL-1035');
  assert.match(col.querySelector('.pane-grid-slug')?.textContent ?? '', /respawned front desk/);
  assert.equal(col.querySelector('.pane-grid-age')?.textContent, '32m');
  assert.equal(col.querySelector('.pane-kind')?.textContent, 'Hardender');
  dom.window.close();
});

test('BL-1046: a single held parcel does not show a batch +N badge', async () => {
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: false,
      panes: [
        {
          id: 'qa',
          label: 'Qa',
          pane: pane({
            roleLabel: 'Qa',
            ticketId: 'BL-1041',
            ticketTitle: 'Ticket BL-1041',
            claimEnteredAtMs: Date.now() - 5 * 60 * 1000,
            heldParcelCount: 1,
          }),
        },
      ],
    })
  );
  await flush();
  const col = dom.window.document.querySelector('.pane-col[data-pane-id="QA"]');
  assert.equal(col.querySelector('.pane-grid-ticket-id')?.textContent, 'BL-1041');
  assert.equal(col.querySelector('.pane-grid-more'), null);
  dom.window.close();
});

test('BL-1046: grid tile omits slug when ticket title is absent', async () => {
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: false,
      panes: [
        {
          id: 'coder',
          label: 'Coder',
          pane: pane({
            roleLabel: 'Coder',
            ticketId: 'BL-999',
            claimEnteredAtMs: Date.now() - 10 * 60 * 1000,
          }),
        },
      ],
    })
  );
  await flush();
  const col = dom.window.document.querySelector('.pane-col[data-pane-id="coder"]');
  assert.equal(col.querySelector('.pane-grid-ticket-id')?.textContent, 'BL-999');
  assert.equal(col.querySelector('.pane-grid-slug'), null);
  dom.window.close();
});
