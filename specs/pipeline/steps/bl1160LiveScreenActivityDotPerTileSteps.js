'use strict';

// BL-1160: per-tile activity dots on the Live Screen phone grid.
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_OUT = path.join(REPO_ROOT, 'extension', 'out');
const EXTENSION_NODE_MODULES = path.join(REPO_ROOT, 'extension', 'node_modules');

const FEATURE = 'each Live Screen role tile owns its own activity status dot';

const PANE_COUNTS = new Set([4, 8]);

const SIGNAL_CASES = {
  coder: { signal: 'ok', colour: 'green' },
  architect: { signal: 'stale', colour: 'amber' },
  qa: { signal: 'err', colour: 'red' },
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

async function waitForVisibleTileDots(document, minVisible, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const visible = [...document.querySelectorAll('.split .pane-col [data-status-indicator]')].filter(
      (dot) => !dot.hidden
    ).length;
    if (visible >= minVisible) {
      return;
    }
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${minVisible} visible tile dots (saw ${document.querySelectorAll('.split .pane-col [data-status-indicator]:not([hidden])').length})`);
}

function panesOf(n, paneOverrides = {}) {
  const roles = ['Coordinator', 'Specifier', 'Coder', 'Cleaner', 'Architect', 'Hardender', 'Documenter', 'Qa'];
  return roles.slice(0, n).map((role) => {
    const id = role.toLowerCase();
    return {
      id,
      label: role,
      pane: {
        available: true,
        roleLabel: role,
        modelLabel: 'Sonnet 5',
        paneText: `${role} live`,
        ...(paneOverrides[id] || {}),
      },
    };
  });
}

function dotColour(dotEl) {
  if (!dotEl || dotEl.hidden) return 'hidden';
  if (dotEl.classList.contains('err')) return 'red';
  if (dotEl.classList.contains('stale')) return 'amber';
  return 'green';
}

async function renderAndExtract({ paneCount = 8, panes, expandRole = null } = {}) {
  const { getResidentSpyUiHtml } = require(path.join(EXTENSION_OUT, 'bridge', 'residentSpyUiHtml'));
  const { JSDOM } = require(path.join(EXTENSION_NODE_MODULES, 'jsdom'));
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  try {
    const payloadPanes = panes || panesOf(paneCount);
    dom.window.fetch = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, monoRouterLayout: false, panes: payloadPanes }),
      });
    dom.window.eval(extractInlineScript(html));
    await flush();
    const { document } = dom.window;
    const expectVisible = payloadPanes.filter((entry) => {
      const pane = entry.pane || {};
      if (pane.activitySignal) return true;
      return pane.available !== false;
    }).length;
    if (expectVisible > 0) {
      await waitForVisibleTileDots(document, expectVisible);
    }
    if (expandRole) {
      const col = document.querySelector(`.pane-col[data-pane-id="${expandRole}"]`);
      if (!col) throw new Error(`pane not found for expand: ${expandRole}`);
      col.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await flush();
    }
    const tileDots = [...document.querySelectorAll('.split .pane-col')].map((col) => {
      const dot = col.querySelector('[data-status-indicator]');
      return {
        id: col.getAttribute('data-pane-id'),
        colour: dotColour(dot),
        insideTile: !!(dot && dot.closest('.pane-head')),
        hasPositionClass: !!(dot && dot.classList.contains('pane-status-dot')),
        indicatorCount: col.querySelectorAll('[data-status-indicator]').length,
      };
    });
    const fsDot = document.getElementById('fs-dot');
    return {
      html: dom.serialize(),
      visibleTileDotCount: tileDots.filter((t) => t.colour !== 'hidden').length,
      tileDots,
      fsDotVisible: !!(fsDot && !fsDot.hidden),
      fsDotColour: dotColour(fsDot),
    };
  } finally {
    dom.window.close();
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the Live Screen is authenticated and showing the role grid$/, () => {});
  scoped(/^the grid renders one tile per role pane$/, () => {});

  scoped(/^the grid is rendering "(\d+)" role panes$/, (ctx, count) => {
    const n = Number(count);
    if (!PANE_COUNTS.has(n)) {
      throw new Error(`unknown pane count in Examples: ${count}`);
    }
    ctx.bl1160PaneCount = n;
    ctx.bl1160SignalPanes = null;
    ctx.bl1160OfflinePanes = null;
  });

  scoped(/^the grid is rendering eight role panes$/, (ctx) => {
    ctx.bl1160PaneCount = 8;
    ctx.bl1160SignalPanes = null;
    ctx.bl1160OfflinePanes = null;
  });

  scoped(/^the role grid renders$/, async (ctx) => {
    if (ctx.bl1160SignalPanes) {
      ctx.bl1160Render = await renderAndExtract({ panes: ctx.bl1160SignalPanes });
      return;
    }
    if (ctx.bl1160OfflinePanes) {
      ctx.bl1160Render = await renderAndExtract({ panes: ctx.bl1160OfflinePanes });
      return;
    }
    ctx.bl1160Render = await renderAndExtract({ paneCount: ctx.bl1160PaneCount || 8 });
  });

  scoped(/^exactly "(\d+)" activity dots appear inside the grid tiles$/, (ctx, count) => {
    if (ctx.bl1160Render.visibleTileDotCount !== Number(count)) {
      throw new Error(
        `expected ${count} visible tile dots, got ${ctx.bl1160Render.visibleTileDotCount}`
      );
    }
  });

  scoped(/^each dot is positioned inside its owning tile$/, (ctx) => {
    for (const tile of ctx.bl1160Render.tileDots) {
      if (!tile.insideTile || !tile.hasPositionClass) {
        throw new Error(`dot for ${tile.id} is not positioned inside its owning tile`);
      }
    }
  });

  scoped(/^the "([^"]+)" tile's freshness signal is "([^"]+)"$/, (ctx, role, signal) => {
    const expected = SIGNAL_CASES[role];
    if (!expected) {
      throw new Error(`unknown role tile in Examples: ${role}`);
    }
    if (expected.signal !== signal) {
      throw new Error(`unknown signal in Examples for ${role}: ${signal}`);
    }
    const id = role.toLowerCase();
    const panes = [
      { id: 'coder', label: 'Coder', pane: { available: true, activitySignal: 'ok' } },
      { id: 'architect', label: 'Architect', pane: { available: true, activitySignal: 'stale' } },
      { id: 'qa', label: 'Qa', pane: { available: true, activitySignal: 'err' } },
    ];
    const target = panes.find((p) => p.id === id);
    if (!target) throw new Error(`unknown role tile: ${role}`);
    target.pane.activitySignal = signal;
    ctx.bl1160SignalPanes = panes;
    ctx.bl1160OfflinePanes = null;
  });

  scoped(/^the "([^"]+)" tile's activity dot has colour "([^"]+)"$/, (ctx, role, colour) => {
    const expected = SIGNAL_CASES[role];
    if (!expected || expected.colour !== colour) {
      throw new Error(`unknown dot colour in Examples for ${role}: ${colour}`);
    }
    const id = role.toLowerCase();
    const tile = ctx.bl1160Render.tileDots.find((t) => t.id === id);
    if (!tile || tile.colour !== expected.colour) {
      throw new Error(
        `expected ${role} dot colour ${expected.colour}, got ${tile ? tile.colour : 'missing'}`
      );
    }
  });

  scoped(/^the "([^"]+)" tile has never been successfully polled$/, (ctx, role) => {
    const id = role.toLowerCase();
    ctx.bl1160OfflinePanes = [
      { id: 'coder', label: 'Coder', pane: { available: true, activitySignal: 'ok' } },
      { id, label: role.charAt(0).toUpperCase() + role.slice(1), pane: { available: false } },
    ];
    ctx.bl1160SignalPanes = null;
  });

  scoped(/^the "([^"]+)" tile's activity dot is hidden or shows non-ok state$/, (ctx, role) => {
    const tile = ctx.bl1160Render.tileDots.find((t) => t.id === role.toLowerCase());
    if (!tile || (tile.colour !== 'hidden' && tile.colour === 'green')) {
      throw new Error(`expected hidden or non-ok dot for ${role}, got ${tile ? tile.colour : 'missing'}`);
    }
  });

  scoped(/^the grid does not read as all green tiles$/, (ctx) => {
    const colours = ctx.bl1160Render.tileDots.map((t) => t.colour);
    if (colours.length > 0 && colours.every((c) => c === 'green')) {
      throw new Error('grid reads as all green tiles');
    }
  });

  scoped(/^the role grid HTML is captured$/, async (ctx) => {
    ctx.bl1160PaneCount = 8;
    ctx.bl1160Render = await renderAndExtract({ paneCount: 8 });
  });

  scoped(/^each pane column contains exactly one status indicator element$/, (ctx) => {
    for (const tile of ctx.bl1160Render.tileDots) {
      if (tile.indicatorCount !== 1) {
        throw new Error(`expected 1 status indicator in ${tile.id}, got ${tile.indicatorCount}`);
      }
    }
  });

  scoped(/^a role tile is expanded to fullscreen$/, (ctx) => {
    ctx.bl1160ExpandRole = 'coder';
  });

  scoped(/^the Expand view renders$/, async (ctx) => {
    ctx.bl1160Render = await renderAndExtract({
      panes: [{ id: 'coder', label: 'Coder', pane: { available: true, activitySignal: 'ok', paneText: 'live' } }],
      expandRole: ctx.bl1160ExpandRole || 'coder',
    });
  });

  scoped(/^a visible activity status cue is still present$/, (ctx) => {
    if (!ctx.bl1160Render.fsDotVisible) {
      throw new Error('fullscreen status cue (#fs-dot) is not visible');
    }
  });
}

module.exports = { registerSteps };
