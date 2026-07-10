const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// BL-118: renders the REAL pwa/index.html + pwa/locales.js + pwa/app.js in
// jsdom (mirroring pwaDocsExplorer.test.js's own pattern) and exercises the
// FR/EN toggle by dispatching real click events - proving the app actually
// switches language rather than restating the toggle logic by hand.

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');

function fakeBacklog(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    board: {
      active: [{ id: 'BL-100', title: 'cost telemetry', titleTranslations: { fr: { title: 'télémétrie des coûts' } }, status: 'active', swarm: 'primary' }],
      paused: [],
      doneByMilestone: {},
    },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
    ...overrides,
  };
}

function fakeDocsTree(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [
      { id: 'specification', title: 'Specification', kind: 'markdown', content: 'English prose.', contentFr: 'Prose française.' },
    ],
    milestones: [{ milestone: 'M4', tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done', priority: 1 }] }],
    tickets: [
      {
        id: 'BL-100',
        title: 'cost telemetry',
        titleFr: 'télémétrie des coûts',
        status: 'done',
        priority: 1,
        milestone: 'M4',
        description: 'English description.',
        descriptionFr: 'Description française.',
        scenarios: [
          {
            id: 'BL-100/s1',
            name: 'per-agent daily tokens match the transcripts',
            text: 'Scenario: per-agent daily tokens match the transcripts\n  Given a transcript\n  Then totals match',
            textFr: 'Scénario : les jetons quotidiens par agent correspondent aux transcriptions\n  Étant donné une transcription\n  Alors les totaux correspondent',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function fakeRecertBatch(overrides = {}) {
  return { schemaVersion: 1, generatedAtIso: '2026-07-09T12:00:00Z', batch: [], ...overrides };
}

function installFakeCaches(dom) {
  const store = new Map();
  dom.window.Response = function (body) {
    this._body = body;
  };
  dom.window.Response.prototype.json = function () {
    return Promise.resolve(JSON.parse(this._body));
  };
  dom.window.Response.prototype.clone = function () {
    return this;
  };
  dom.window.caches = {
    open(name) {
      if (!store.has(name)) {
        store.set(name, new Map());
      }
      const cache = store.get(name);
      return Promise.resolve({
        match(key) {
          return Promise.resolve(cache.get(String(key)));
        },
        put(key, response) {
          cache.set(String(key), response);
          return Promise.resolve();
        },
      });
    },
  };
  return store;
}

function renderDashboard(opts = {}) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  if (opts.withCaches) {
    installFakeCaches(dom);
  }
  dom.window.fetch = (url) => {
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(opts.backlog || fakeBacklog()) });
    }
    if (url === './docs-tree.json') {
      return Promise.resolve({ json: () => Promise.resolve(opts.docsTree || fakeDocsTree()) });
    }
    if (url === './recert-batch.json') {
      return Promise.resolve({ json: () => Promise.resolve(opts.recertBatch || fakeRecertBatch()) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  const localesSource = fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8');
  dom.window.eval(localesSource);
  const appSource = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  dom.window.eval(appSource);
  return dom;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function click(dom, element) {
  element.dispatchEvent(new dom.window.Event('click'));
}

function toggle(dom) {
  return dom.window.document.getElementById('localeToggle');
}

// ── bilingual-01 ─────────────────────────────────────────────────────────

test('bilingual-01: first launch renders English chrome with the toggle visible', async () => {
  const dom = renderDashboard();
  await flush();
  assert.equal(dom.window.document.getElementById('pageHeading').textContent, 'SwarmForge — backlog dashboard');
  assert.match(dom.window.document.querySelector('#board h3').textContent, /^Active/);
  const t = toggle(dom);
  assert.ok(t, 'the FR/EN toggle button must be present');
  assert.equal(t.textContent, 'FR');
});

// BL-238: the toggle's visible text is just a locale code ("FR"/"EN"),
// which is not descriptive out of context for a screen reader - it must
// carry a real accessible name, applied on load like every other chrome
// string (bilingual-01's "never derived at runtime alone" posture).
test('BL-238: the locale toggle has an accessible name, in both locales', async () => {
  const dom = renderDashboard();
  await flush();
  assert.equal(toggle(dom).getAttribute('aria-label'), 'Switch language');

  click(dom, toggle(dom));
  assert.equal(toggle(dom).getAttribute('aria-label'), 'Changer de langue');
});

// ── bilingual-02 ─────────────────────────────────────────────────────────

test('bilingual-02: tapping the toggle switches chrome and content to French instantly, no reload', async () => {
  const dom = renderDashboard();
  await flush();

  click(dom, toggle(dom));

  assert.equal(dom.window.document.getElementById('pageHeading').textContent, 'SwarmForge — tableau de bord');
  assert.match(dom.window.document.querySelector('#board h3').textContent, /^Actifs/);
  assert.equal(toggle(dom).textContent, 'EN');
});

test('bilingual-02: toggling back to EN restores English chrome', async () => {
  const dom = renderDashboard();
  await flush();
  click(dom, toggle(dom));
  click(dom, toggle(dom));

  assert.equal(dom.window.document.getElementById('pageHeading').textContent, 'SwarmForge — backlog dashboard');
  assert.equal(toggle(dom).textContent, 'FR');
});

test('bilingual-02: the toggle persists the choice via Cache Storage, not localStorage/sessionStorage', async () => {
  const dom = renderDashboard({ withCaches: true });
  await flush();

  click(dom, toggle(dom));
  await flush();

  const cache = await dom.window.caches.open('swarmforge-dashboard-preferences');
  const stored = await cache.match('./__locale-preference__');
  assert.ok(stored, 'the locale preference must be written into the existing dashboard cache');
  const data = await stored.json();
  assert.equal(data.locale, 'fr');
});

test('bilingual-02: a persisted French preference is restored on reopen (no toggle tap needed)', async () => {
  const first = renderDashboard({ withCaches: true });
  await flush();
  click(first, toggle(first));
  await flush();
  const cacheStore = await first.window.caches.open('swarmforge-dashboard-preferences');
  const stored = await cacheStore.match('./__locale-preference__');
  const persisted = await stored.json();
  assert.equal(persisted.locale, 'fr');

  // "reopen": a fresh DOM/app instance, seeded with the same persisted cache entry.
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const second = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  installFakeCaches(second);
  await second.window.caches.open('swarmforge-dashboard-preferences').then((c) => c.put('./__locale-preference__', new second.window.Response(JSON.stringify({ locale: 'fr' }))));
  second.window.fetch = (url) => {
    if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
    if (url === './recert-batch.json') return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  await flush();
  await flush(); // one extra tick for the async cache lookup + re-render

  assert.equal(second.window.document.getElementById('pageHeading').textContent, 'SwarmForge — tableau de bord');
});

// ── bilingual-03 ─────────────────────────────────────────────────────────

test('bilingual-03: documentation content and ticket title/description display in French once toggled', async () => {
  const dom = renderDashboard();
  await flush();
  click(dom, toggle(dom));

  const specButton = [...dom.window.document.getElementById('docsExplorer').querySelectorAll('button')].find((b) => b.textContent === 'Specification');
  click(dom, specButton);
  assert.match(dom.window.document.getElementById('docsExplorer').textContent, /Prose française\./);

  click(dom, [...dom.window.document.getElementById('docsCrumbs').querySelectorAll('button')][0]); // back to root
  const milestoneButton = [...dom.window.document.getElementById('docsExplorer').querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0);
  click(dom, milestoneButton);
  const ticketButton = [...dom.window.document.getElementById('docsExplorer').querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0);
  click(dom, ticketButton);
  assert.match(dom.window.document.getElementById('docsExplorer').textContent, /télémétrie des coûts/);
  assert.match(dom.window.document.getElementById('docsExplorer').textContent, /Description française\./);
});

test('bilingual-05: a ticket with no titleFr/contentFr falls back to English rather than showing nothing', async () => {
  const tree = fakeDocsTree();
  delete tree.tickets[0].titleFr;
  delete tree.tickets[0].descriptionFr;
  const dom = renderDashboard({ docsTree: tree });
  await flush();
  click(dom, toggle(dom));

  const milestoneButton = [...dom.window.document.getElementById('docsExplorer').querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0);
  click(dom, milestoneButton);
  assert.match(dom.window.document.getElementById('docsExplorer').textContent, /cost telemetry/, 'falls back to the English title');
});

// ── bilingual-04 ─────────────────────────────────────────────────────────

test('bilingual-04: the Gherkin scenario always shows canonical English text, even in FR mode', async () => {
  const dom = renderDashboard();
  await flush();
  click(dom, toggle(dom)); // switch to FR

  const explorer = dom.window.document.getElementById('docsExplorer');
  click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  click(dom, explorer.querySelector('button')); // into the one scenario

  const gherkin = explorer.querySelector('.gherkin');
  assert.match(gherkin.textContent, /Given a transcript/, 'canonical English text must show even while the app is in FR mode');
});

test('bilingual-04: one tap reveals the French rendering of the scenario, hidden by default', async () => {
  const dom = renderDashboard();
  await flush();
  const explorer = dom.window.document.getElementById('docsExplorer');
  click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  click(dom, explorer.querySelector('button'));

  const frBlock = explorer.querySelector('.french-reveal');
  assert.ok(frBlock, 'a French rendering block must exist once a translation is available');
  assert.equal(frBlock.style.display, 'none', 'hidden until tapped');

  const revealBtn = [...explorer.querySelectorAll('button')].find((b) => b.textContent === 'Show French rendering');
  assert.ok(revealBtn);
  click(dom, revealBtn);

  assert.notEqual(frBlock.style.display, 'none');
  assert.match(frBlock.textContent, /Étant donné une transcription/);
  assert.equal(revealBtn.textContent, 'Hide French rendering');
});

test('bilingual-04: a scenario with no textFr shows no reveal affordance at all', async () => {
  const tree = fakeDocsTree();
  delete tree.tickets[0].scenarios[0].textFr;
  const dom = renderDashboard({ docsTree: tree });
  await flush();
  const explorer = dom.window.document.getElementById('docsExplorer');
  click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  click(dom, explorer.querySelector('button'));

  assert.equal(explorer.querySelector('.french-reveal'), null);
});

// ── bilingual-06: the docs explorer's read-only guarantee is unaffected ──

test('bilingual-06/docs-drilldown-05: the French reveal button is not an edit affordance (no input/textarea/form)', async () => {
  const dom = renderDashboard();
  await flush();
  const explorer = dom.window.document.getElementById('docsExplorer');
  click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('M4') === 0));
  click(dom, [...explorer.querySelectorAll('button')].find((b) => b.textContent.indexOf('BL-100') === 0));
  click(dom, explorer.querySelector('button'));

  const editableElements = explorer.querySelectorAll('input, textarea, [contenteditable="true"], form');
  assert.equal(editableElements.length, 0);
});

// ── board titles ────────────────────────────────────────────────────────

test('board ticket titles switch to titleTranslations.fr in FR mode and back to title in EN mode', async () => {
  const dom = renderDashboard();
  await flush();
  assert.match(dom.window.document.getElementById('board').textContent, /cost telemetry/);

  click(dom, toggle(dom));
  assert.match(dom.window.document.getElementById('board').textContent, /télémétrie des coûts/);

  click(dom, toggle(dom));
  assert.match(dom.window.document.getElementById('board').textContent, /cost telemetry/);
});

// ── BL-230: N-locale board title generalization ──────────────────────────

test('BL-230 fallback-03: a board ticket with no titleTranslations for the active locale falls back to its source title', async () => {
  const backlog = {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    board: { active: [{ id: 'BL-101', title: 'untranslated ticket', status: 'active', swarm: 'primary' }], paused: [], doneByMilestone: {} },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
  };
  const dom = renderDashboard({ backlog });
  await flush();

  click(dom, toggle(dom)); // en -> fr, but this ticket has no translation at all

  assert.match(dom.window.document.getElementById('board').textContent, /untranslated ticket/);
});

test('BL-230 source-unchanged-04: the source locale always shows the authored title, even when a translation exists', async () => {
  const dom = renderDashboard();
  await flush();

  assert.match(dom.window.document.getElementById('board').textContent, /cost telemetry/);
  assert.doesNotMatch(dom.window.document.getElementById('board').textContent, /télémétrie des coûts/);
});

test('BL-230 add-language-05: a locale added to window.LOCALES joins the toggle cycle and board titles resolve against it, with no app.js change', async () => {
  const backlog = {
    schemaVersion: 1,
    generatedAtIso: '2026-07-09T12:00:00Z',
    sourceSha: 'abc123def456',
    board: {
      active: [
        {
          id: 'BL-100',
          title: 'cost telemetry',
          titleTranslations: { fr: { title: 'télémétrie des coûts' }, es: { title: 'telemetría de costos' } },
          status: 'active',
          swarm: 'primary',
        },
      ],
      paused: [],
      doneByMilestone: {},
    },
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
  };
  const dom = renderDashboard({ backlog });
  await flush();
  // 'es' is not a real shipped chrome-catalog locale yet (FR is BL-230's
  // first delivered target) - adding it here purely as data proves the
  // cycle/lookup mechanism is generic, without claiming ES ships today.
  dom.window.LOCALES.es = Object.assign({}, dom.window.LOCALES.en, { localeToggleLabel: 'ES' });

  click(dom, toggle(dom)); // en -> fr
  assert.match(dom.window.document.getElementById('board').textContent, /télémétrie des coûts/);

  click(dom, toggle(dom)); // fr -> es
  assert.match(dom.window.document.getElementById('board').textContent, /telemetría de costos/);

  click(dom, toggle(dom)); // es -> en, cycling back to the start
  assert.match(dom.window.document.getElementById('board').textContent, /cost telemetry/);
});

test('BL-230: a persisted locale no longer in the configured set is ignored, falling back to the default', async () => {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  installFakeCaches(dom);
  await dom.window.caches
    .open('swarmforge-dashboard-preferences')
    .then((c) => c.put('./__locale-preference__', new dom.window.Response(JSON.stringify({ locale: 'de' }))));
  dom.window.fetch = (url) => {
    if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
    if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
    if (url === './recert-batch.json') return Promise.resolve({ json: () => Promise.resolve(fakeRecertBatch()) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  await flush();
  await flush();

  assert.equal(dom.window.document.getElementById('pageHeading').textContent, 'SwarmForge — backlog dashboard');
});

// ── BL-229: hardcoded PWA labels now route through the locale catalog ───

test('label-catalog-01: the burndown "remaining" label is a real catalog lookup, not a hardcoded literal', async () => {
  const backlog = fakeBacklog({
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [{ milestone: 'M4', currentRemaining: 2, trend: { direction: 'unknown' }, dailySeries: [] }],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: { tickets: [], milestones: [] },
    },
  });
  const dom = renderDashboard({ backlog });
  await flush();
  assert.match(dom.window.document.getElementById('burndown').textContent, /2 remaining/);

  // Swapping the catalog value proves the render actually reads it live -
  // a hardcoded ' remaining' literal would be unaffected by this change.
  dom.window.LOCALES.fr.remainingSuffix = ' SENTINEL-RESTANTS';
  click(dom, toggle(dom));
  assert.match(dom.window.document.getElementById('burndown').textContent, /2 SENTINEL-RESTANTS/);
});

test('label-catalog-01: the French catalog default for "remaining" is the ordinary-word translation "restants"', async () => {
  const dom = renderDashboard();
  await flush();
  assert.equal(dom.window.LOCALES.fr.remainingSuffix, ' restants');
});

test('label-catalog-02: the ETA label is a catalog lookup, and French keeps the jargon value "ETA"', async () => {
  const backlog = fakeBacklog({
    board: {
      active: [{ id: 'BL-100', title: 'x', status: 'active', swarm: 'primary', p50Iso: '2026-08-01T00:00:00Z' }],
      paused: [],
      doneByMilestone: {},
    },
  });
  const dom = renderDashboard({ backlog });
  await flush();
  assert.match(dom.window.document.getElementById('board').textContent, /— ETA 2026-08-01/);

  // Per the operator's rule, jargon may keep its English value in French -
  // still a catalog lookup, so the two locale entries are simply equal.
  assert.equal(dom.window.LOCALES.fr.etaPrefix, dom.window.LOCALES.en.etaPrefix);

  click(dom, toggle(dom));
  assert.match(dom.window.document.getElementById('board').textContent, /— ETA 2026-08-01/);
});

test('no-hardcoded-03: the previously-hardcoded ETA and remaining literals no longer appear as inline string literals in app.js', () => {
  const source = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
  assert.doesNotMatch(source, /['"] — ETA ['"]/, 'the ETA label must be a tr(...) catalog lookup, not an inline literal');
  assert.doesNotMatch(source, /['"] remaining['"]/, 'the remaining-count label must be a tr(...) catalog lookup, not an inline literal');
  assert.match(source, /tr\('etaPrefix'\)/);
  assert.match(source, /tr\('remainingSuffix'\)/);
});

// ── BL-228: the burndown's forecast ETA and overall ETA are localized ───

test('BL-228: the burndown milestone ETA and overall ETA switch to their French catalog values', async () => {
  const backlog = fakeBacklog({
    metrics: {
      velocity: { weeklySeries: [], trend: { direction: 'unknown' }, rollingWindowCount: 0, rollingWindowDays: 7 },
      burndown: [{ milestone: 'M4', currentRemaining: 2, trend: { direction: 'unknown' }, dailySeries: [] }],
      cycleTime: { medianMs: null, p85Ms: null, sampleCount: 0, trend: { direction: 'unknown' }, weeklySeries: [] },
      forecasts: {
        tickets: [{ ticketId: 'BL-1', p50Iso: '2026-08-01T00:00:00Z', p85Iso: null }],
        milestones: [{ milestone: 'M4', p50Iso: '2026-08-01T00:00:00Z', p85Iso: null }],
        throughputPerDay: 0.5,
      },
    },
  });
  const dom = renderDashboard({ backlog });
  await flush();
  click(dom, toggle(dom));

  const text = dom.window.document.getElementById('burndown').textContent;
  assert.match(text, /^ETA globale : 2026-08-01/);
  assert.match(text, /M4: 2 restants — ETA 2026-08-01/);
});
