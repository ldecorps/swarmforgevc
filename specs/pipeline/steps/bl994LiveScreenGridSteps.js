'use strict';

// BL-994: step handlers for "Live Screen role tiles are a square-ish grid,
// not thin strips". Drives the REAL getResidentSpyUiHtml() output through
// jsdom (runScripts:'outside-only' + a manual window.eval of the inline
// client script) - the SAME pattern residentSpyUiHtml.test.js and
// bl929LiveScreenPackLayoutSteps.js already use for this exact page.
//
// Every render reads its result out into a PLAIN object and closes the
// jsdom window before returning - bl929LiveScreenPackLayoutSteps.js's own
// renderLiveScreen docstring explains why: the served page registers real
// setInterval polls, and a window left open keeps them alive, so the
// generated test file's `node --test` process never exits (confirmed live
// while building this file: an early draft that held a live dom/window
// across step boundaries hung the acceptance run with zero output).
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_OUT = path.join(REPO_ROOT, 'extension', 'out');
const EXTENSION_NODE_MODULES = path.join(REPO_ROOT, 'extension', 'node_modules');

const FEATURE = 'Live Screen role tiles are a square-ish grid, not thin strips';

const VIEWPORTS = {
  'phone portrait': 375,
  '700px wide': 700,
};

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

function panesOf(n) {
  const roles = ['Coordinator', 'Specifier', 'Coder', 'Cleaner', 'Architect', 'Hardener', 'Documenter', 'Qa'];
  return roles.slice(0, n).map((role) => ({
    id: role.toLowerCase(),
    label: role,
    pane: { available: true, roleLabel: role, modelLabel: 'Sonnet 5', paneText: `${role} live output` },
  }));
}

// Renders the page for paneCount panes, optionally clicking a tile to open
// Expand, then reads every field ANY of this feature's Then steps need into
// a plain object before closing the window.
async function renderAndExtract(paneCount, { expandFirstTile } = {}) {
  const { getResidentSpyUiHtml } = require(path.join(EXTENSION_OUT, 'bridge', 'residentSpyUiHtml'));
  const { JSDOM } = require(path.join(EXTENSION_NODE_MODULES, 'jsdom'));

  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  const panes = panesOf(paneCount);
  dom.window.fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ available: true, monoRouterLayout: false, panes }) });
  dom.window.eval(extractInlineScript(html));
  await flush();

  const { document } = dom.window;
  let expandedPaneLabel = null;
  if (expandFirstTile) {
    expandedPaneLabel = panes[0].label;
    const col = document.querySelector(`.pane-col[data-pane-id="${panes[0].id}"]`);
    col.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
  }

  const tiles = panes.map((p) => {
    const col = document.querySelector(`.pane-col[data-pane-id="${p.id}"]`);
    const pre = col.querySelector('pre');
    return {
      id: p.id,
      label: p.label,
      roleNameText: col.querySelector('.pane-kind')?.textContent ?? null,
      hasExpandHint: !!col.querySelector('.pane-expand-hint'),
      transcriptDisplay: dom.window.getComputedStyle(pre).display,
    };
  });

  const result = {
    html,
    tiles,
    fullscreenActive: document.body.classList.contains('pane-fullscreen-active'),
    fullscreenHidden: document.getElementById('pane-fullscreen').hidden,
    fsHeadHtml: document.getElementById('fs-head').innerHTML,
    fsPreText: document.getElementById('fs-pre').textContent,
    expandedPaneLabel,
    expandedPaneText: expandFirstTile ? panes[0].pane.paneText : null,
  };
  dom.window.close();
  return result;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^the Live Screen is rendered for the running pack$/, () => {
    // No fixture setup here - each scenario's own "Given N worker panes are
    // visible" step below carries the actual pane count.
  });

  scoped(/^(\d+) worker panes? are visible$/, (ctx, countText) => {
    ctx.paneCount = Number(countText);
  });

  scoped(/^the Live Screen is viewed at (phone portrait|700px wide)$/, async (ctx, viewport) => {
    const { resolveGridColumns } = require(path.join(EXTENSION_OUT, '..', 'test', 'helpers', 'resolveGridColumns'));
    ctx.viewportWidth = VIEWPORTS[viewport];
    ctx.render = await renderAndExtract(ctx.paneCount);
    ctx.resolvedColumns = resolveGridColumns(ctx.render.html, ctx.paneCount, ctx.viewportWidth);
  });

  scoped(/^the tiles are laid out in (\d+) columns$/, (ctx, columnsText) => {
    const expected = Number(columnsText);
    if (ctx.resolvedColumns !== expected) {
      throw new Error(
        `${ctx.paneCount} panes at ${ctx.viewportWidth}px resolved to ${ctx.resolvedColumns} columns, expected ${expected}`
      );
    }
  });

  scoped(/^each tile shows its role name as unbroken text$/, (ctx) => {
    const { extractStyleBlock } = require(path.join(EXTENSION_OUT, '..', 'test', 'helpers', 'resolveGridColumns'));
    const css = extractStyleBlock(ctx.render.html);
    const kindRule = css.match(/\.pane-kind\s*\{([^}]*)\}/);
    if (!kindRule || !/word-break:\s*normal/.test(kindRule[1])) {
      throw new Error('.pane-kind must set word-break: normal - a role name must never stack one letter per line');
    }
    for (const tile of ctx.render.tiles) {
      if (tile.roleNameText !== tile.label) {
        throw new Error(`tile "${tile.id}" does not show its role name as unbroken text (got "${tile.roleNameText}")`);
      }
    }
  });

  scoped(/^each tile shows its role name and an Expand control$/, (ctx) => {
    for (const tile of ctx.render.tiles) {
      if (!tile.roleNameText || !tile.hasExpandHint) {
        throw new Error(`tile "${tile.id}" is missing its role name or Expand control`);
      }
    }
  });

  scoped(/^no tile shows the pane transcript$/, (ctx) => {
    for (const tile of ctx.render.tiles) {
      if (tile.transcriptDisplay !== 'none') {
        throw new Error(`tile "${tile.id}" shows its pane transcript in the grid (display: ${tile.transcriptDisplay})`);
      }
    }
  });

  scoped(/^a tile's Expand control is opened$/, async (ctx) => {
    ctx.render = await renderAndExtract(ctx.paneCount, { expandFirstTile: true });
  });

  scoped(/^the fullscreen view shows that pane's full metadata and transcript$/, (ctx) => {
    const r = ctx.render;
    if (!r.fullscreenActive || r.fullscreenHidden) {
      throw new Error('fullscreen mode was not entered');
    }
    if (!r.fsHeadHtml.includes(r.expandedPaneLabel)) {
      throw new Error("fullscreen head does not show the expanded pane's role/metadata");
    }
    if (r.fsPreText !== r.expandedPaneText) {
      throw new Error("fullscreen does not show the expanded pane's transcript");
    }
  });
}

module.exports = { registerSteps };
