// BL-994: pipeline landing of the human's captured Live Screen grid hotfix
// (backlog/evidence/INTAKE-live-screen-role-tile-grid-hotfix.patch) - .split
// was a flex row with a percentage flex-basis, which shrank panes into thin
// vertical strips with role names stacked one letter per line. Same jsdom +
// runScripts:'outside-only' pattern residentSpyUiHtml.test.js already
// established for this page - never a hand-rolled reimplementation of the
// client-side layout/expand logic.
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { getResidentSpyUiHtml } = require('../out/bridge/residentSpyUiHtml');
const { resolveGridColumns, extractStyleBlock } = require('./helpers/resolveGridColumns');

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

function residentPaneResponse(data) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}

function panesOf(n) {
  const roles = ['Coordinator', 'Specifier', 'Coder', 'Cleaner', 'Architect', 'Hardener', 'Documenter', 'Qa'];
  return roles.slice(0, n).map((role) => ({
    id: role.toLowerCase(),
    label: role,
    pane: pane({ roleLabel: role }),
  }));
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

// ── role-tiles-square-ish-grid-01 ────────────────────────────────────────
// (the resolved column count, not a CSS-string presence check)
for (const [panesCount, viewportWidth, expectedColumns] of [
  [4, 375, 2],
  [1, 375, 1],
  [6, 375, 2],
  [6, 700, 3],
  [8, 700, 4],
]) {
  test(`BL-994: ${panesCount} panes at ${viewportWidth}px resolve to ${expectedColumns} grid columns`, () => {
    const html = getResidentSpyUiHtml();
    assert.equal(resolveGridColumns(html, panesCount, viewportWidth), expectedColumns);
  });
}

// ── role-name-reads-as-a-word-02 ─────────────────────────────────────────
test('BL-994: a role name is never stacked one letter per line', async () => {
  const html = getResidentSpyUiHtml();
  const css = extractStyleBlock(html);
  const kindRule = css.match(/\.pane-kind\s*\{([^}]*)\}/);
  assert.ok(kindRule, '.pane-kind rule not found');
  assert.match(kindRule[1], /word-break:\s*normal/);
  assert.match(kindRule[1], /overflow-wrap:\s*normal/);
  assert.doesNotMatch(kindRule[1], /word-break:\s*break-word/);

  const dom = renderScreen(() => residentPaneResponse({ available: true, monoRouterLayout: false, panes: panesOf(4) }));
  await flush();
  const kindEl = dom.window.document.querySelector('.pane-col[data-pane-id="coordinator"] .pane-kind');
  assert.ok(kindEl, '.pane-kind element not found in a rendered tile');
  assert.equal(kindEl.textContent, 'Coordinator');
});

// ── grid-tile-carries-role-name-and-expand-only-03 ───────────────────────
test('BL-994: a grid tile carries the role name and an Expand control and nothing else', async () => {
  const dom = renderScreen(() => residentPaneResponse({ available: true, monoRouterLayout: false, panes: panesOf(4) }));
  await flush();
  const { window } = dom;
  const col = window.document.querySelector('.pane-col[data-pane-id="coordinator"]');
  assert.ok(col.querySelector('.pane-kind'), 'role name missing from the tile');
  assert.ok(col.querySelector('.pane-expand-hint'), 'Expand control missing from the tile');

  const pre = col.querySelector('pre');
  assert.ok(pre, 'the pane transcript node must still exist (Expand reads live payload, not this node)');
  assert.equal(window.getComputedStyle(pre).display, 'none', 'the pane transcript must not be shown in the grid tile');
});

// ── expand-fullscreen-is-unchanged-04 ────────────────────────────────────
test('BL-994: Expand still opens the full metadata and transcript', async () => {
  const dom = renderScreen(() =>
    residentPaneResponse({
      available: true,
      monoRouterLayout: false,
      panes: [
        { id: 'coordinator', label: 'Coordinator', pane: pane({ roleLabel: 'Coordinator', paneText: 'live pane output here' }) },
        ...panesOf(4).slice(1),
      ],
    })
  );
  await flush();
  const { window } = dom;
  const col = window.document.querySelector('.pane-col[data-pane-id="coordinator"]');
  col.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();

  assert.equal(window.document.body.classList.contains('pane-fullscreen-active'), true);
  assert.equal(window.document.getElementById('pane-fullscreen').hidden, false);
  assert.match(window.document.getElementById('fs-head').innerHTML, /Coordinator/);
  assert.equal(window.document.getElementById('fs-pre').textContent, 'live pane output here');
});
