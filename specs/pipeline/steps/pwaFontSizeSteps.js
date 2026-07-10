'use strict';

// BL-220: step handlers for the PWA font-size feature. Drives the real
// pwa/app.js + pwa/locales.js (via render-dashboard-font-size.js, jsdom,
// mirroring pwaLabelCatalogSteps.js's own render-script pattern) - no live
// fetch, no real timers.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-dashboard-font-size.js');
const INDEX_HTML_PATH = path.join(__dirname, '..', '..', '..', 'pwa', 'index.html');

const DEFAULT_PX = 28;
const STEP_PX = 2;

function render(mode, control, count) {
  const out = execFileSync('node', [RENDER_SCRIPT, mode, control, String(count)], { encoding: 'utf8' });
  return JSON.parse(out);
}

// A representative sample of view-defining selectors, proving text is
// sized relative to the root (rem), not fixed (px) - the premise the whole
// feature depends on (a single root knob scales every view together).
const REM_VIEW_SELECTORS = ['h2 {', 'h3, h4 {', 'ul {', '.doc-content {', '.gherkin {'];

function findNonRemSelectors(html) {
  return REM_VIEW_SELECTORS.filter((sel) => {
    const idx = html.indexOf(sel);
    if (idx === -1) {
      return true;
    }
    const ruleEnd = html.indexOf('}', idx);
    return !/font-size:\s*[\d.]+rem/.test(html.slice(idx, ruleEnd));
  });
}

// Reads the real markup by default; a test may inject ctx.html to exercise
// this step's failure branch without touching the real file on disk.
function readIndexHtml(ctx) {
  return (ctx && ctx.html) || fs.readFileSync(INDEX_HTML_PATH, 'utf8');
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the PWA phone app, whose views all size in rem from the root font-size$/, (ctx) => {
    const missing = findNonRemSelectors(readIndexHtml(ctx));
    if (missing.length > 0) {
      throw new Error(`expected these view selectors to size in rem: ${missing.join(', ')}`);
    }
  });

  // ── default-large-01 ─────────────────────────────────────────────────
  registry.define(/^no font-size preference has ever been saved$/, () => {
    // No fixture setup needed - render-dashboard-font-size.js's "click"
    // mode always starts from a fresh, cache-less load.
  });

  registry.define(/^the page loads$/, (ctx) => {
    ctx.result = render('click', 'A+', 0);
  });

  registry.define(/^the root font-size is 28px$/, (ctx) => {
    if (ctx.result.fontSizePx !== DEFAULT_PX) {
      throw new Error(`expected the default root font-size to be ${DEFAULT_PX}px, got ${ctx.result.fontSizePx}px`);
    }
  });

  registry.define(/^every view scales up from that root together$/, (ctx) => {
    // Same rem-sizing premise the Background already verified, restated
    // here as its own Then per the scenario's own wording - both read the
    // real markup, not a second implementation.
    const missing = findNonRemSelectors(readIndexHtml(ctx));
    if (missing.length > 0) {
      throw new Error(`expected these view selectors to still scale via rem: ${missing.join(', ')}`);
    }
  });

  // ── step-02 ──────────────────────────────────────────────────────────
  registry.define(/^the app is showing the default font size$/, () => {
    // No fixture setup needed - each render starts fresh at the default.
  });

  registry.define(/^the operator activates the "([^"]+)" control$/, (ctx, control) => {
    ctx.control = control;
    ctx.result = render('click', control, 1);
  });

  registry.define(/^the root font-size (grows|shrinks) by one 2px step$/, (ctx, direction) => {
    const expected = direction === 'grows' ? DEFAULT_PX + STEP_PX : DEFAULT_PX - STEP_PX;
    if (ctx.result.fontSizePx !== expected) {
      throw new Error(`expected the root font-size to be ${expected}px after one ${ctx.control} tap, got ${ctx.result.fontSizePx}px`);
    }
  });

  registry.define(/^the new size applies immediately with no reload$/, (ctx) => {
    // render-dashboard-font-size.js's "click" mode clicks and reads the
    // result within a single jsdom instance/process, with no navigation or
    // reload in between - a definite numeric result here IS that proof (a
    // reload would have discarded the click and jsdom has no real
    // navigation support, so the process would error instead of returning
    // a clean value).
    if (typeof ctx.result.fontSizePx !== 'number') {
      throw new Error('expected a definite font-size reading with no reload in between');
    }
  });

  // ── clamp-03 ─────────────────────────────────────────────────────────
  registry.define(/^the root font-size is already at its (maximum|minimum)$/, (ctx, bound) => {
    ctx.bound = bound;
  });

  registry.define(/^the operator activates the "([^"]+)" control repeatedly$/, (ctx, control) => {
    ctx.control = control;
    ctx.result = render('click', control, 30);
  });

  registry.define(/^the root font-size never passes (\d+)px$/, (ctx, limit) => {
    if (ctx.result.fontSizePx !== Number(limit)) {
      throw new Error(`expected the clamped font-size to be exactly ${limit}px, got ${ctx.result.fontSizePx}px`);
    }
  });

  // ── persist-04 ───────────────────────────────────────────────────────
  registry.define(/^the operator has changed the font size to a non-default value$/, (ctx) => {
    ctx.control = 'A+';
    ctx.clicks = 3;
  });

  registry.define(/^the app is closed and reopened$/, (ctx) => {
    ctx.result = render('persist', ctx.control, ctx.clicks);
  });

  registry.define(/^the page loads at the previously chosen size, not the default$/, (ctx) => {
    if (ctx.result.beforePx === DEFAULT_PX) {
      throw new Error('setup sanity: expected the chosen size to be non-default before reopening');
    }
    if (ctx.result.reopenPx !== ctx.result.beforePx) {
      throw new Error(`expected the reopened size (${ctx.result.reopenPx}px) to match the previously chosen size (${ctx.result.beforePx}px)`);
    }
  });
}

module.exports = { registerSteps };
