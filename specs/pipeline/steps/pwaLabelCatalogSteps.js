'use strict';

// BL-229: step handlers for the PWA-label-catalog feature. Drives the real
// pwa/app.js + pwa/locales.js (via render-dashboard-labels.js, jsdom,
// mirroring recertAddressSteps.js's own render-script pattern) - no live
// fetch, no real timers.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-dashboard-labels.js');
const APP_JS_PATH = path.join(__dirname, '..', '..', '..', 'pwa', 'app.js');

function fakeBacklog(overrides) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123',
    board: { active: [], paused: [], doneByMilestone: {} },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
    ...overrides,
  };
}

function renderDashboardLabels(backlog, locale) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-pwa-labels-'));
  const fixturePath = path.join(tmpDir, 'backlog.json');
  fs.writeFileSync(fixturePath, JSON.stringify(backlog));
  const out = execFileSync('node', [RENDER_SCRIPT, fixturePath, locale], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  // ── label-catalog-01 / label-catalog-02 share this Given ────────────
  registry.define(/^the PWA in French$/, (ctx) => {
    ctx.locale = 'fr';
  });

  // ── label-catalog-01 ─────────────────────────────────────────────────
  registry.define(/^the burndown is rendered$/, (ctx) => {
    const backlog = fakeBacklog({
      metrics: {
        velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
        burndown: [{ milestone: 'M4', currentRemaining: 2, trend: { direction: 'unknown' }, dailySeries: [] }],
        cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
        forecasts: { tickets: [], milestones: [] },
      },
    });
    ctx.rendered = renderDashboardLabels(backlog, ctx.locale);
  });

  registry.define(/^the remaining-count label shows its French catalog value, not the English word "remaining"$/, (ctx) => {
    if (!/2 restants/.test(ctx.rendered.burndownText)) {
      throw new Error(`expected the French catalog value "restants", got: ${ctx.rendered.burndownText}`);
    }
    if (/\bremaining\b/.test(ctx.rendered.burndownText)) {
      throw new Error(`expected the English word "remaining" to be gone in French mode, got: ${ctx.rendered.burndownText}`);
    }
  });

  // ── label-catalog-02 ─────────────────────────────────────────────────
  registry.define(/^a ticket ETA is rendered$/, (ctx) => {
    const backlog = fakeBacklog({
      board: {
        active: [{ id: 'BL-100', title: 'x', status: 'active', swarm: 'primary', p50Iso: '2026-08-01T00:00:00Z' }],
        paused: [],
        doneByMilestone: {},
      },
    });
    ctx.rendered = renderDashboardLabels(backlog, ctx.locale);
  });

  registry.define(/^the ETA label is a catalog lookup, whose French value may remain "ETA" as jargon$/, (ctx) => {
    if (!/— ETA 2026-08-01/.test(ctx.rendered.boardText)) {
      throw new Error(`expected a catalog-sourced ETA label (jargon "ETA" retained), got: ${ctx.rendered.boardText}`);
    }
  });

  // ── no-hardcoded-03 ──────────────────────────────────────────────────
  registry.define(/^the PWA render functions$/, (ctx) => {
    ctx.appSource = fs.readFileSync(APP_JS_PATH, 'utf8');
  });

  registry.define(/^they build user-visible label text$/, () => {
    // Nothing to do - the previous Given already loaded the real source
    // the Then step below audits.
  });

  registry.define(/^every such label is a tr\(\.\.\.\) catalog lookup, not an inline English string literal$/, (ctx) => {
    if (/['"] — ETA ['"]/.test(ctx.appSource)) {
      throw new Error('expected the ETA label to be a tr(...) catalog lookup, found an inline " — ETA " literal');
    }
    if (/['"] remaining['"]/.test(ctx.appSource)) {
      throw new Error('expected the remaining-count label to be a tr(...) catalog lookup, found an inline " remaining" literal');
    }
    if (!/tr\('etaPrefix'\)/.test(ctx.appSource) || !/tr\('remainingSuffix'\)/.test(ctx.appSource)) {
      throw new Error('expected both etaPrefix and remainingSuffix catalog lookups to be present in app.js');
    }
  });
}

module.exports = { registerSteps };
