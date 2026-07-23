'use strict';

// BL-261: step handlers for "the phone app flags an untranslated French
// rendering instead of passing English off as French". Drives the REAL
// pwa/index.html + pwa/app.js + pwa/locales.js (via
// render-docs-untranslated.js, jsdom, mirroring pwaFontSizeSteps.js's own
// render-script pattern) - no live fetch, no real timers.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-docs-untranslated.js');
const APP_JS_PATH = path.join(__dirname, '..', '..', '..', 'pwa', 'app.js');
const LOCALES_PATH = path.join(__dirname, '..', '..', '..', 'pwa', 'locales.js');

// One fixture-builder per Examples-table `surface` value (a closed, known
// set from the feature file's own table - not open text), mapping the
// Gherkin's own wording to the render script's argv.
const SURFACE_ARGS = {
  'ticket title': 'title',
  'ticket description': 'description',
  'vision doc content': 'vision',
  'Gherkin scenario': 'scenario',
};

function render(surfaceArg, mode) {
  const out = execFileSync('node', [RENDER_SCRIPT, surfaceArg, mode], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^the phone docs drill-down where a French rendering may be a real translation or an untranslated English fallback$/,
    () => {
      // Non-behavioral: each scenario's own Given below picks the fixture
      // mode (flagged vs clean) and drives the real render script.
    }
  );

  // ── untranslated-flagged-01 ───────────────────────────────────────────
  registry.define(/^a "([^"]+)" whose French field is an untranslated English fallback$/, (ctx, surface) => {
    const surfaceArg = SURFACE_ARGS[surface];
    if (!surfaceArg) {
      throw new Error(`unrecognized surface: "${surface}"`);
    }
    ctx.surfaceArg = surfaceArg;
  });

  registry.define(/^the operator views its French rendering$/, (ctx) => {
    ctx.result = render(ctx.surfaceArg, 'flagged');
  });

  registry.define(/^a machine-translation-unavailable indicator is shown$/, (ctx) => {
    const visible = ctx.surfaceArg === 'title' ? /indisponible/.test(ctx.result.surfaceText) : ctx.result.noticeVisible;
    if (!visible) {
      throw new Error(`expected the untranslated indicator to be shown, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  registry.define(/^the fallback text is not presented as a genuine French translation$/, (ctx) => {
    if (ctx.surfaceArg === 'scenario' && ctx.result.noticeBeforeReveal !== false) {
      throw new Error('expected the indicator hidden until the reveal tap, matching the French block itself');
    }
    // The indicator itself (asserted present above) IS the "not presented
    // as genuine" signal - a bare, unflagged fallback would show none.
  });

  // ── real-translation-not-flagged-02 ──────────────────────────────────
  registry.define(/^a French field that is a genuine translation$/, (ctx) => {
    ctx.surfaceArg = 'description';
  });

  registry.define(/^the translated text is shown with no machine-translation-unavailable indicator$/, (ctx) => {
    ctx.result = render(ctx.surfaceArg, 'clean');
    if (ctx.result.noticePresent) {
      throw new Error(`expected no untranslated-notice element for a genuine translation, got: ${JSON.stringify(ctx.result)}`);
    }
    if (!/Description française/.test(ctx.result.surfaceText)) {
      throw new Error(`expected the real translated text to still render, got: ${ctx.result.surfaceText}`);
    }
  });

  // ── indicator-localized-03 ────────────────────────────────────────────
  registry.define(/^an untranslated French rendering$/, (ctx) => {
    ctx.surfaceArg = 'vision';
  });

  registry.define(/^the indicator is shown$/, (ctx) => {
    ctx.result = render(ctx.surfaceArg, 'flagged');
    if (!ctx.result.noticeVisible) {
      throw new Error('expected the indicator to be shown for this fixture');
    }
  });

  registry.define(/^its text comes from the locale table rather than a hardcoded string$/, (ctx) => {
    const appSource = fs.readFileSync(APP_JS_PATH, 'utf8');
    if (!/tr\('translationUnavailableNotice'\)/.test(appSource)) {
      throw new Error('expected app.js to read the indicator text via tr(...), a locale catalog lookup');
    }
    const localesSource = fs.readFileSync(LOCALES_PATH, 'utf8');
    const enMatch = localesSource.match(/en:\s*\{[\s\S]*?translationUnavailableNotice:\s*'([^']+)'/);
    const frMatch = localesSource.match(/fr:\s*\{[\s\S]*?translationUnavailableNotice:\s*'([^']+)'/);
    if (!enMatch || !frMatch) {
      throw new Error('expected translationUnavailableNotice in both en and fr locale catalogs');
    }
    if (enMatch[1] === frMatch[1]) {
      throw new Error('expected a genuinely translated fr value, not the English string reused verbatim');
    }
    if (ctx.result.noticeText !== frMatch[1]) {
      throw new Error(`expected the rendered indicator to match the fr catalog value exactly, got: "${ctx.result.noticeText}"`);
    }
  });
}

module.exports = { registerSteps };
