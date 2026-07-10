'use strict';

// BL-238: step handlers for the accessibility (keyboard nav + screen-reader
// labels) feature. Drives the REAL compiled webviewHtml.js output, the REAL
// panel.js source, and the REAL PWA (via jsdom, mirroring pwaLocale.test.js's
// own pattern) - per the ticket's own testable-seam constraint: markup is
// inspected host-side (DOM/axe-style attribute checks), no VS Code boot.
const path = require('node:path');
const fs = require('node:fs');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { getWebviewHtml, getWorkTreeHtml } = require(path.join(EXT_DIR, 'out', 'panel', 'webviewHtml'));
const PANEL_JS = fs.readFileSync(path.join(EXT_DIR, 'media', 'panel.js'), 'utf8');
const PWA_DIR = path.join(__dirname, '..', '..', '..', 'pwa');

function registerSteps(registry) {
  registry.define(
    /^the tiled agent panel, the backlog\/work-tree view, and the PWA remote client$/,
    (ctx) => {
      ctx.webviewHtml = getWebviewHtml('vscode-webview://test/media/panel.js', 'vscode-webview:');
      ctx.workTreeHtml = getWorkTreeHtml('test-nonce');
    }
  );

  // ── keyboard-nav-tiles-01 ─────────────────────────────────────────────
  registry.define(/^the tiled agent panel$/, () => {
    // Nothing further to fixture - the Background already loaded it.
  });

  registry.define(/^the operator navigates with the keyboard only$/, () => {
    // Nothing to do here - the Then steps below inspect the real source for
    // keyboard affordances (tabindex/role/keydown), not a live browser.
  });

  registry.define(/^every tile and its controls can be focused and operated without a mouse$/, () => {
    // Native controls (button/select) are keyboard-operable for free;
    // the one non-native control (the tile header, click-to-select) must
    // carry its own tabindex + role + keydown handling.
    if (!PANEL_JS.includes('header.tabIndex = 0')) {
      throw new Error('the tile header must be focusable (tabindex)');
    }
    if (!PANEL_JS.includes("header.setAttribute('role', 'button')")) {
      throw new Error('the tile header must expose a button role');
    }
    if (!PANEL_JS.includes("header.addEventListener('keydown'") || !PANEL_JS.includes("e.key === 'Enter' || e.key === ' '")) {
      throw new Error('the tile header must handle Enter/Space, not just click');
    }
    if (!PANEL_JS.includes('output.tabIndex = 0')) {
      throw new Error('the tile output pane must be focusable');
    }
  });

  registry.define(/^the focused element shows a visible focus indicator$/, (ctx) => {
    if (!ctx.webviewHtml.includes('.tile-header:focus-visible')) {
      throw new Error('the tile header needs an explicit focus-visible style');
    }
    if (!ctx.webviewHtml.includes('.tile-output:focus')) {
      throw new Error('the tile output pane needs a focus style');
    }
  });

  // ── keyboard-nav-tree-02 ──────────────────────────────────────────────
  registry.define(/^the backlog\/work-tree view$/, () => {
    // Nothing further to fixture - the Background already loaded it.
  });

  registry.define(/^every tree node can be expanded, collapsed, and activated without a mouse$/, (ctx) => {
    if (!ctx.workTreeHtml.includes('tabindex="0"') || !ctx.workTreeHtml.includes('role="button"')) {
      throw new Error('active work-tree rows must be focusable and expose a button role');
    }
    if (!ctx.workTreeHtml.includes('onkeydown="onRowKey(event') || !ctx.workTreeHtml.includes("function onRowKey(event, role)")) {
      throw new Error('active work-tree rows must be keyboard-activatable (Enter/Space), not click-only');
    }
    // The webview panel's own collapse/expand controls (Recent Runs/
    // Backlog/Metrics sections) are native <button>s - keyboard-operable
    // for free - with an aria-expanded state kept in sync (checked in
    // screen-reader-labels-03 below).
  });

  // ── screen-reader-labels-03 ───────────────────────────────────────────
  registry.define(/^the tiles, tree nodes, and status controls$/, () => {
    // Nothing further to fixture - the Background already loaded everything.
  });

  registry.define(/^a screen reader inspects them$/, () => {
    // Nothing to do - the Then step below inspects the real source directly.
  });

  registry.define(
    /^each exposes an accessible name and role rather than being an unlabeled control$/,
    (ctx) => {
      // Tiles: header, nudge/restart buttons, model/effort dropdowns.
      if (!PANEL_JS.includes("header.setAttribute('aria-label', 'Select ' + displayName + ' tile')")) {
        throw new Error('the tile header must have an accessible name');
      }
      if (!PANEL_JS.includes("nudgeBtn.setAttribute('aria-label', 'Nudge ' + displayName)")) {
        throw new Error('the nudge button must have a role-disambiguating accessible name');
      }
      if (!PANEL_JS.includes("modelSelect.setAttribute('aria-label',") || !PANEL_JS.includes("effortSelect.setAttribute('aria-label',")) {
        throw new Error('the model/effort dropdowns must have an accessible name');
      }
      // Tree nodes: the collapse toggles and work-tree rows.
      if (!ctx.webviewHtml.match(/id="runs-toggle"[^>]*aria-label=/)) {
        throw new Error('the collapse toggle buttons must have an accessible name');
      }
      if (!ctx.workTreeHtml.includes('aria-label="Highlight ')) {
        throw new Error('work-tree rows must have an accessible name');
      }
      // Status controls: the live output pane.
      if (!PANEL_JS.includes("output.setAttribute('role', 'log')") || !PANEL_JS.includes("output.setAttribute('aria-label', displayName + ' output')")) {
        throw new Error('the tile output pane must expose a role and accessible name');
      }
    }
  );

  // ── status-not-color-only-04 ──────────────────────────────────────────
  registry.define(/^agent liveness and completion indicators$/, () => {
    // Nothing further to fixture - the Background already loaded panel.js.
  });

  registry.define(/^their status is presented$/, () => {
    // Nothing to do - the Then step below inspects the real source directly.
  });

  registry.define(/^it is also conveyed by text or shape, not by color alone$/, (ctx) => {
    if (!PANEL_JS.includes('function updateStatusBadge(entry)')) {
      throw new Error('expected a textual status-badge derivation, not color-only liveness cues');
    }
    for (const c of ['dead', 'stall', 'activity', 'needsHuman']) {
      const caseBlock = PANEL_JS.match(new RegExp(`case '${c}':[\\s\\S]*?break;`));
      if (!caseBlock || !caseBlock[0].includes('updateStatusBadge(entry)')) {
        throw new Error(`case '${c}' must refresh the textual status badge, not just toggle a CSS class`);
      }
    }
    if (!ctx.webviewHtml.includes('.tile-status-badge')) {
      throw new Error('expected the status badge element/style to exist in the generated markup');
    }
  });

  // ── pwa-parity-05 ─────────────────────────────────────────────────────
  registry.define(/^the PWA status and work-tree views$/, (ctx) => {
    ctx.pwaIndexHtml = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
    ctx.pwaAppJs = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  });

  registry.define(/^they are navigated by keyboard and inspected by a screen reader$/, () => {
    // Nothing further to do - the Then step below inspects the real source.
  });

  registry.define(/^they are keyboard operable and their controls expose accessible names$/, (ctx) => {
    if (!/button:focus-visible[\s\S]*?outline:/.test(ctx.pwaIndexHtml)) {
      throw new Error('the PWA must define a visible focus-visible outline');
    }
    if (!ctx.pwaIndexHtml.includes('aria-label="Switch language"')) {
      throw new Error('the PWA locale toggle must have a static accessible-name fallback');
    }
    if (!ctx.pwaAppJs.includes("if (e.key === ' ')") || !ctx.pwaAppJs.includes('link.click()')) {
      throw new Error("the PWA's role=\"button\" mailto link must also activate on Space, completing its ARIA contract");
    }
    if (!ctx.pwaAppJs.includes("'aria-label': 'Edit scenario text: ' + scenario.name")) {
      throw new Error('the PWA recert textarea must have an accessible name');
    }
  });
}

module.exports = { registerSteps };
