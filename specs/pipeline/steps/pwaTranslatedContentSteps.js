'use strict';

// BL-230: step handlers for the build-time-auto-translate feature. Drives
// the REAL pwa/app.js + pwa/locales.js (via render-dashboard-labels.js,
// jsdom, mirroring pwaLabelCatalogSteps.js's own render-script pattern) fed
// a fixture backlog.json whose board ticket carries titleTranslations - no
// live translation API, no live browser call (the build-time contract
// itself is covered separately by backlogDashboard.test.js and
// translate.test.js).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const RENDER_SCRIPT = path.join(__dirname, '..', '..', '..', 'extension', 'scripts', 'render-dashboard-labels.js');

function fakeBacklog(ticket) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123',
    board: { active: [ticket], paused: [], doneByMilestone: {} },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
  };
}

function renderBoard(ticket, locale, extraLocales) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-pwa-translated-'));
  const fixturePath = path.join(tmpDir, 'backlog.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fakeBacklog(ticket)));
  const args = [RENDER_SCRIPT, fixturePath, locale];
  if (extraLocales) {
    args.push(JSON.stringify(extraLocales));
  }
  const out = execFileSync('node', args, { encoding: 'utf8' });
  return JSON.parse(out).boardText;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(
    /^a build-time pass that auto-translates source content into each configured target locale, preserving a defined jargon list$/,
    () => {
      // Documents the mechanism (backlogDashboard.ts's translateSummary +
      // jargonPreserve.ts) - each scenario below builds its own fixture,
      // already shaped as if that pass had already run.
    }
  );

  // ── content-translated-01 (Scenario Outline: fr, es) ───────────────────
  // Fixed, independent of the Examples-table value fed in below: the
  // titleTranslations key and the "expected" text a later step checks for
  // must NOT both be derived from the same runtime `locale` variable, or a
  // mutated example value (e.g. "fr" -> "fR") threads through self-
  // consistently and the render call always finds "its own" fixture entry -
  // no mutation of the table can ever be observed. Looking the locale up in
  // this fixed catalog instead means an unrecognized/mutated value is
  // rejected here, before it can reach the render call at all.
  const CONTENT_TRANSLATED_FIXTURES = {
    fr: { title: '[fr] cost telemetry rollup', extraLocales: undefined },
    // 'es' is not a real shipped target locale yet (FR is BL-230's first
    // delivered target) - injecting it as data-only proves the render
    // mechanism generalizes without claiming ES ships today.
    es: { title: '[es] cost telemetry rollup', extraLocales: { es: { localeToggleLabel: 'ES' } } },
  };

  registry.define(
    /^a ticket whose source title is a prose sentence and a "([^"]+)" translation was produced at build time$/,
    (ctx, locale) => {
      const fixture = CONTENT_TRANSLATED_FIXTURES[locale];
      if (!fixture) {
        throw new Error(`content-translated-01 has no fixed fixture for locale "${locale}"`);
      }
      ctx.locale = locale;
      ctx.ticket = {
        id: 'BL-100',
        title: 'cost telemetry rollup',
        status: 'active',
        swarm: 'primary',
        titleTranslations: { [locale]: { title: fixture.title } },
      };
      ctx.expectedTitle = fixture.title;
      ctx.extraLocales = fixture.extraLocales;
    }
  );

  registry.define(/^the board is rendered in "([^"]+)"$/, (ctx, locale) => {
    ctx.locale = locale;
    ctx.boardText = renderBoard(ctx.ticket, locale, ctx.extraLocales);
  });

  registry.define(/^the title is shown as a sentence in that locale$/, (ctx) => {
    if (!ctx.boardText.includes(ctx.expectedTitle)) {
      throw new Error(`expected the board to show "${ctx.expectedTitle}", got: ${ctx.boardText}`);
    }
  });

  // ── jargon-preserved-02 ──────────────────────────────────────────────
  registry.define(/^a source title containing jargon such as a BL-id, a role name, or a product\/tech term$/, (ctx) => {
    ctx.ticket = {
      id: 'BL-230',
      title: 'Fix BL-230 before release',
      status: 'active',
      swarm: 'primary',
      // A realistic build-time result: MT translated the prose, the
      // jargon token itself survived verbatim (mtEngine.test.js/
      // jargonPreserve.test.js cover the wrap/unwrap mechanism itself).
      titleTranslations: { fr: { title: 'Réparer BL-230 avant la sortie' } },
    };
  });

  registry.define(/^it is shown in a target locale$/, (ctx) => {
    ctx.boardText = renderBoard(ctx.ticket, 'fr');
  });

  registry.define(/^those jargon tokens remain in their original form within the translated sentence$/, (ctx) => {
    if (!ctx.boardText.includes('BL-230')) {
      throw new Error(`expected the jargon token "BL-230" to survive translation verbatim, got: ${ctx.boardText}`);
    }
  });

  // ── fallback-03 ───────────────────────────────────────────────────────
  registry.define(/^a ticket with no translation for the active locale$/, (ctx) => {
    ctx.ticket = { id: 'BL-101', title: 'untranslated ticket', status: 'active', swarm: 'primary' };
  });

  registry.define(/^the board is rendered in that locale$/, (ctx) => {
    ctx.boardText = renderBoard(ctx.ticket, 'fr');
  });

  registry.define(/^it falls back to the source text, never an error or a blank$/, (ctx) => {
    if (!ctx.boardText.includes('untranslated ticket')) {
      throw new Error(`expected fallback to the source title, got: ${ctx.boardText}`);
    }
  });

  // ── source-unchanged-04 ──────────────────────────────────────────────
  registry.define(/^the PWA in the source locale$/, (ctx) => {
    ctx.ticket = {
      id: 'BL-102',
      title: 'authored source title',
      status: 'active',
      swarm: 'primary',
      titleTranslations: { fr: { title: 'titre source traduit' } },
    };
  });

  registry.define(/^the board is rendered$/, (ctx) => {
    ctx.boardText = renderBoard(ctx.ticket, 'en');
  });

  registry.define(/^ticket titles show their authored source text$/, (ctx) => {
    if (!ctx.boardText.includes('authored source title')) {
      throw new Error(`expected the source-locale board to show the authored title, got: ${ctx.boardText}`);
    }
  });

  // ── add-language-05 ──────────────────────────────────────────────────
  registry.define(/^a new target locale is added to the configured locale set$/, (ctx) => {
    ctx.ticket = {
      id: 'BL-103',
      title: 'a third locale ticket',
      status: 'active',
      swarm: 'primary',
      titleTranslations: { fr: { title: 'ticket de troisieme locale' }, de: { title: 'Ticket-der-dritten-Locale' } },
    };
    // Config-only: a locale added to the chrome catalog + backlog build
    // pass, no app.js/render code touched to reach it (this JSON injection
    // stands in for pwa/locales.js gaining a real "de" entry).
    ctx.extraLocales = { de: { localeToggleLabel: 'DE' } };
  });

  registry.define(/^the dashboard is rebuilt and the PWA is opened in that locale$/, (ctx) => {
    ctx.boardText = renderBoard(ctx.ticket, 'de', ctx.extraLocales);
  });

  registry.define(/^its content is auto-translated and rendered with no code change specific to that language$/, (ctx) => {
    if (!ctx.boardText.includes('Ticket-der-dritten-Locale')) {
      throw new Error(`expected the newly-added locale's translated title to render, got: ${ctx.boardText}`);
    }
  });
}

module.exports = { registerSteps };
