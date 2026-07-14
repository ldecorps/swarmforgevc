'use strict';

// BL-291: step handlers for the PWA collapsible-sections feature. Drives the
// real pwa/app.js + pwa/locales.js (via render-dashboard-collapsible-sections.js,
// jsdom, mirroring pwaFontSizeSteps.js's own render-script pattern) - no live
// fetch, no real timers.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-dashboard-collapsible-sections.js');
const INDEX_HTML_PATH = path.join(__dirname, '..', '..', '..', 'pwa', 'index.html');

const ALL_SECTION_KEYS = [
  'needsApprovalHeading',
  'boardHeading',
  'velocityHeading',
  'burndownHeading',
  'cycleTimeHeading',
  'suiteDurationHeading',
  'costHealthHeading',
  'documentationHeading',
  'recertHeading',
];

function render(...args) {
  const out = execFileSync('node', [RENDER_SCRIPT, ...args], { encoding: 'utf8' });
  return JSON.parse(out).sections;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the static PWA renders each top-level section with a header control$/, () => {
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    const missing = ALL_SECTION_KEYS.filter((key) => !html.includes('data-i18n="' + key + '"'));
    if (missing.length > 0) {
      throw new Error(`expected every section heading to be present in index.html: missing ${missing.join(', ')}`);
    }
  });

  // ── collapsible-sections-01 ─────────────────────────────────────────
  registry.define(/^a section whose body is shown$/, (ctx) => {
    ctx.key = 'velocityHeading';
  });

  registry.define(/^its header control is activated$/, (ctx) => {
    ctx.sections = render('click', ctx.key, '1');
  });

  registry.define(/^the section body is hidden$/, (ctx) => {
    if (ctx.sections[ctx.key].bodyDisplay !== 'none') {
      throw new Error(`expected ${ctx.key}'s body to be hidden after one activation, got display="${ctx.sections[ctx.key].bodyDisplay}"`);
    }
  });

  registry.define(/^activating it once more shows the body again$/, (ctx) => {
    const sections = render('click', ctx.key, '2');
    if (sections[ctx.key].bodyDisplay === 'none') {
      throw new Error(`expected ${ctx.key}'s body to be shown again after a second activation`);
    }
  });

  // ── collapsible-sections-02 ─────────────────────────────────────────
  registry.define(/^a section header control$/, (ctx) => {
    ctx.key = 'burndownHeading';
  });

  registry.define(/^it is operated by keyboard$/, (ctx) => {
    ctx.sections = render('keydown', ctx.key, 'Enter', '1');
  });

  registry.define(/^it toggles the section body$/, (ctx) => {
    if (ctx.sections[ctx.key].bodyDisplay !== 'none') {
      throw new Error(`expected ${ctx.key}'s body to hide after a keyboard Enter activation`);
    }
  });

  registry.define(/^its aria-expanded reflects whether the section is open$/, (ctx) => {
    if (ctx.sections[ctx.key].ariaExpanded !== 'false') {
      throw new Error(`expected ${ctx.key}'s header aria-expanded to be "false" while collapsed, got "${ctx.sections[ctx.key].ariaExpanded}"`);
    }
    const reopened = render('keydown', ctx.key, ' ', '2');
    if (reopened[ctx.key].ariaExpanded !== 'true') {
      throw new Error(`expected ${ctx.key}'s header aria-expanded to be "true" once reopened by a Space keypress, got "${reopened[ctx.key].ariaExpanded}"`);
    }
  });

  // ── collapsible-sections-03 ─────────────────────────────────────────
  registry.define(/^a section the human has collapsed$/, (ctx) => {
    ctx.key = 'cycleTimeHeading';
  });

  registry.define(/^the PWA is reloaded$/, (ctx) => {
    ctx.sections = render('reopen', ctx.key);
  });

  registry.define(/^that section is restored collapsed from the preferences cache$/, (ctx) => {
    if (ctx.sections[ctx.key].bodyDisplay !== 'none' || ctx.sections[ctx.key].ariaExpanded !== 'false') {
      throw new Error(`expected ${ctx.key} to reopen collapsed (body hidden, aria-expanded="false"), got ${JSON.stringify(ctx.sections[ctx.key])}`);
    }
  });

  // ── collapsible-sections-04 ─────────────────────────────────────────
  registry.define(/^several expanded sections$/, (ctx) => {
    ctx.key = 'boardHeading';
    ctx.others = ['needsApprovalHeading', 'velocityHeading', 'recertHeading'];
  });

  registry.define(/^one is collapsed$/, (ctx) => {
    ctx.sections = render('click', ctx.key, '1');
  });

  registry.define(/^only that section collapses and the rest stay expanded$/, (ctx) => {
    if (ctx.sections[ctx.key].bodyDisplay !== 'none') {
      throw new Error(`expected ${ctx.key} to be collapsed`);
    }
    const untouched = ctx.others.filter((key) => ctx.sections[key].bodyDisplay === 'none');
    if (untouched.length > 0) {
      throw new Error(`expected these sections to stay expanded but they collapsed too: ${untouched.join(', ')}`);
    }
  });

  // ── collapsible-sections-05 ───────────────────────────────────────────
  registry.define(/^no saved section state in the preferences cache$/, () => {
    // No fixture setup needed - render-dashboard-collapsible-sections.js's
    // "fresh" mode always starts from a fresh, cache-less-but-installed load.
  });

  registry.define(/^the dashboard first renders$/, (ctx) => {
    ctx.sections = render('fresh');
  });

  registry.define(/^every section starts expanded$/, (ctx) => {
    const collapsed = ALL_SECTION_KEYS.filter((key) => ctx.sections[key].ariaExpanded !== 'true');
    if (collapsed.length > 0) {
      throw new Error(`expected every section to start expanded (aria-expanded="true"), but these did not: ${collapsed.join(', ')}`);
    }
  });
}

module.exports = { registerSteps };
