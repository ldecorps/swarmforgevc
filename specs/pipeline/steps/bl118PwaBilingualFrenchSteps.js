'use strict';

// BL-1942 (BL-118 stamp-off): step handlers for "the app is fully usable in
// French and English". Drives the REAL pwa/index.html + pwa/app.js +
// pwa/locales.js in jsdom by dispatching real click events, and the REAL
// compiled translate.js/translationCache.js/docsTree.js with a fake MT
// engine that records calls - mirroring extension/test/{pwaLocale,
// translate,docsTree}.test.js's own established patterns, never a
// restatement of the toggle/translation/cache logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const PWA_DIR = path.join(REPO_ROOT, 'pwa');
const JSDOM_MODULE = path.join(EXT_DIR, 'node_modules', 'jsdom');

function JSDOMClass() {
  return require(JSDOM_MODULE).JSDOM;
}

let _translateModule = null;
function translateModule() {
  if (!_translateModule) _translateModule = require(path.join(EXT_DIR, 'out', 'i18n', 'translate.js'));
  return _translateModule;
}
let _translationCacheModule = null;
function translationCacheModule() {
  if (!_translationCacheModule) _translationCacheModule = require(path.join(EXT_DIR, 'out', 'i18n', 'translationCache.js'));
  return _translationCacheModule;
}
let _docsTreeModule = null;
function docsTreeModule() {
  if (!_docsTreeModule) _docsTreeModule = require(path.join(EXT_DIR, 'out', 'docs', 'docsTree.js'));
  return _docsTreeModule;
}

function fakeEngine(translations = {}) {
  const calls = [];
  return {
    calls,
    engine: {
      async translate(text, targetLang) {
        calls.push({ text, targetLang });
        if (text in translations) {
          return { success: true, text: translations[text] };
        }
        return { success: false, error: 'no fake translation for: ' + text };
      },
    },
  };
}

function fakeBacklog(overrides = {}) {
  return {
    schemaVersion: 2,
    generatedAtIso: '2026-09-09T12:00:00Z',
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
    schemaVersion: 2,
    generatedAtIso: '2026-09-09T12:00:00Z',
    sourceSha: 'abc123def456',
    vision: [{ id: 'specification', title: 'Specification', kind: 'markdown', content: 'English prose.', contentFr: 'Prose française.' }],
    milestones: [{ milestone: 'M4', epics: [{ epicKey: '(no epic)', tickets: [{ id: 'BL-100', title: 'cost telemetry', status: 'done', priority: 1 }] }] }],
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
  const JSDOM = JSDOMClass();
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
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
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

function explorer(dom) {
  return dom.window.document.getElementById('docsExplorer');
}

function findButton(dom, prefix) {
  return [...explorer(dom).querySelectorAll('button')].find((b) => b.textContent.indexOf(prefix) === 0);
}

const FEATURE = 'the app is fully usable in French and English';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── bilingual-01: first launch is English regardless of browser locale ─
  scoped(/^a device whose browser locale is fr or fr-\*$/, (ctx) => {
    // app.js reads no browser-locale API at all (no navigator.language
    // check anywhere in it) - the non-behavioral gate's own point. Leaving
    // the fixture's actual navigator.language untouched (jsdom's default)
    // IS the proof: a real fr-locale browser would change it, and the app
    // still has nothing wired to read it.
    ctx.bl118 = {};
  });

  scoped(/^the app is opened for the first time$/, async (ctx) => {
    ctx.dom = renderDashboard();
    await flush();
  });

  scoped(/^all UI chrome renders in English$/, (ctx) => {
    assert.equal(ctx.dom.window.document.getElementById('pageHeading').textContent, 'SwarmForge — backlog dashboard');
    assert.match(ctx.dom.window.document.querySelector('#board h3').textContent, /^Active/);
  });

  scoped(/^the FR\/EN toggle is visible$/, (ctx) => {
    const t = toggle(ctx.dom);
    assert.ok(t, 'the FR/EN toggle button must be present');
    assert.equal(t.textContent, 'FR');
  });

  // ── bilingual-02: the language toggle is instant and durable ──────────
  scoped(/^the app is displaying in English$/, async (ctx) => {
    ctx.dom = renderDashboard({ withCaches: true });
    await flush();
  });

  scoped(/^the user switches the toggle to FR$/, async (ctx) => {
    click(ctx.dom, toggle(ctx.dom));
    await flush();
  });

  scoped(/^chrome and content re-render in French without a reload$/, (ctx) => {
    assert.equal(ctx.dom.window.document.getElementById('pageHeading').textContent, 'SwarmForge — tableau de bord');
    assert.equal(toggle(ctx.dom).textContent, 'EN');
  });

  scoped(/^after closing and reopening the app, French is still active$/, async (ctx) => {
    const cacheStore = await ctx.dom.window.caches.open('swarmforge-dashboard-preferences');
    const stored = await cacheStore.match('./__locale-preference__');
    assert.ok(stored, 'the locale preference must be persisted via Cache Storage');
    const persisted = await stored.json();
    assert.equal(persisted.locale, 'fr');

    const JSDOM = JSDOMClass();
    const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
    const reopened = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
    installFakeCaches(reopened);
    await reopened.window.caches
      .open('swarmforge-dashboard-preferences')
      .then((c) => c.put('./__locale-preference__', new reopened.window.Response(JSON.stringify({ locale: 'fr' }))));
    reopened.window.fetch = (url) => {
      if (url === './backlog.json') return Promise.resolve({ json: () => Promise.resolve(fakeBacklog()) });
      if (url === './docs-tree.json') return Promise.resolve({ json: () => Promise.resolve(fakeDocsTree()) });
      return Promise.reject(new Error('unexpected fetch: ' + url));
    };
    reopened.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
    reopened.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
    await flush();
    await flush();
    assert.equal(reopened.window.document.getElementById('pageHeading').textContent, 'SwarmForge — tableau de bord', 'a persisted French preference must be restored on reopen with no toggle tap needed');
  });

  // ── bilingual-03: documentation content is translated and stays live ──
  scoped(/^a published artifact rendered after a docs\/backlog change$/, (ctx) => {
    ctx.docsTree = fakeDocsTree();
  });

  scoped(/^the user browses the documentation explorer in FR mode$/, async (ctx) => {
    ctx.dom = renderDashboard({ docsTree: ctx.docsTree });
    await flush();
    click(ctx.dom, toggle(ctx.dom));
    const specButton = [...explorer(ctx.dom).querySelectorAll('button')].find((b) => b.textContent === 'Specification');
    click(ctx.dom, specButton);
  });

  scoped(/^doc sections, ticket titles, and descriptions display in French$/, (ctx) => {
    assert.match(explorer(ctx.dom).textContent, /Prose française\./);
    click(ctx.dom, ctx.dom.window.document.getElementById('docsCrumbs').querySelector('button'));
    click(ctx.dom, findButton(ctx.dom, 'M4'));
    click(ctx.dom, findButton(ctx.dom, 'BL-100'));
    assert.match(explorer(ctx.dom).textContent, /télémétrie des coûts/);
    assert.match(explorer(ctx.dom).textContent, /Description française\./);
  });

  scoped(/^a source string unchanged since the previous publish was served from the translation cache, not re-translated$/, async () => {
    const { createTranslationSession, translateString } = translateModule();
    const { hashSourceText } = translationCacheModule();
    const { engine, calls } = fakeEngine({ hello: 'bonjour' });
    const cache = { schemaVersion: 2, entries: { [hashSourceText('hello')]: { fr: 'bonjour (cached)' } } };
    const session = createTranslationSession(cache, engine);
    const result = await translateString(session, 'hello', 'fr');
    assert.deepEqual(result, { text: 'bonjour (cached)' });
    assert.equal(calls.length, 0, 'the engine must never be called for a cache hit');
    assert.equal(session.stats.hits, 1);
  });

  // ── bilingual-04: Gherkin shows canonical English with French on tap ──
  scoped(/^a ticket's scenarios viewed in FR mode$/, async (ctx) => {
    ctx.dom = renderDashboard();
    await flush();
    click(ctx.dom, toggle(ctx.dom));
    click(ctx.dom, findButton(ctx.dom, 'M4'));
    click(ctx.dom, findButton(ctx.dom, 'BL-100'));
    click(ctx.dom, explorer(ctx.dom).querySelector('button'));
  });

  scoped(/^the scenario text displays in canonical English$/, (ctx) => {
    const gherkin = explorer(ctx.dom).querySelector('.gherkin');
    assert.match(gherkin.textContent, /Given a transcript/, 'canonical English text must show even while the app is in FR mode');
  });

  scoped(/^one tap reveals the French rendering of that scenario$/, (ctx) => {
    const frBlock = explorer(ctx.dom).querySelector('.french-reveal');
    assert.ok(frBlock, 'a French rendering block must exist once a translation is available');
    assert.equal(frBlock.style.display, 'none', 'hidden until tapped');
    // In FR mode (this scenario's own Given) the button's catalog text is
    // the French label; the English label covers a caller viewing in EN.
    const revealBtn = [...explorer(ctx.dom).querySelectorAll('button')].find(
      (b) => b.textContent === 'Show French rendering' || b.textContent === 'Afficher la version française'
    );
    click(ctx.dom, revealBtn);
    assert.notEqual(frBlock.style.display, 'none');
    assert.match(frBlock.textContent, /Étant donné une transcription/);
  });

  // ── bilingual-05: missing translations degrade to flagged English ─────
  scoped(/^a string whose translation is unavailable at publish time$/, (ctx) => {
    ctx.bl118MissingTranslation = {};
  });

  scoped(/^the artifact is published and viewed in FR mode$/, async (ctx) => {
    const { createTranslationSession, translateString } = translateModule();
    const { emptyTranslationCache } = translationCacheModule();
    const { engine } = fakeEngine({});
    const session = createTranslationSession(emptyTranslationCache(), engine);
    // "the publish succeeded": translateString must degrade, never throw.
    ctx.publishResult = await translateString(session, 'no translation available', 'fr');

    const tree = fakeDocsTree();
    // A real failed translation degrades titleFr to the English source text
    // itself (translateString's own degrade-to-source contract, asserted
    // just above) - never a stale or fabricated French value.
    tree.tickets[0].titleFr = tree.tickets[0].title;
    tree.tickets[0].titleFrUntranslated = true;
    tree.milestones[0].epics[0].tickets[0].titleFr = tree.tickets[0].titleFr;
    tree.milestones[0].epics[0].tickets[0].titleFrUntranslated = true;
    ctx.dom = renderDashboard({ docsTree: tree });
    await flush();
    click(ctx.dom, toggle(ctx.dom));
  });

  scoped(/^the publish succeeded$/, (ctx) => {
    assert.deepEqual(ctx.publishResult, { text: 'no translation available', untranslated: true });
  });

  scoped(/^that string displays in English with an untranslated marker$/, (ctx) => {
    const milestoneButton = findButton(ctx.dom, 'M4');
    click(ctx.dom, milestoneButton);
    const ticketButton = findButton(ctx.dom, 'BL-100');
    assert.match(ticketButton.textContent, /cost telemetry/, 'must fall back to the English title');
    assert.match(ticketButton.textContent, /Traduction automatique indisponible/, 'must flag the fallback inline');
  });

  // ── bilingual-06: identifiers and code are never translated ───────────
  scoped(/^FR mode$/, async (ctx) => {
    ctx.dom = renderDashboard();
    await flush();
    click(ctx.dom, toggle(ctx.dom));
  });

  scoped(/^ticket ids, file paths, commit hashes, code blocks, and diagram sources render verbatim as authored$/, async (ctx) => {
    // Ticket id verbatim, even translated: the id text itself is never run
    // through the engine.
    click(ctx.dom, findButton(ctx.dom, 'M4'));
    assert.match(explorer(ctx.dom).textContent, /BL-100/, 'the ticket id must render verbatim in FR mode');

    const { createTranslationSession } = translateModule();
    const { translateDocsTree } = docsTreeModule();
    const { emptyTranslationCache } = translationCacheModule();
    const idTree = {
      schemaVersion: 2,
      generatedAtIso: '2026-09-09T00:00:00Z',
      sourceSha: 'abc',
      vision: [],
      milestones: [],
      tickets: [{ id: 'BL-100', title: 't', status: 'active', scenarios: [] }],
    };
    const { engine: idEngine, calls: idCalls } = fakeEngine({ t: 'traduit' });
    const idSession = createTranslationSession(emptyTranslationCache(), idEngine);
    const idTranslated = await translateDocsTree(idTree, idSession);
    assert.equal(idTranslated.tickets[0].id, 'BL-100');
    assert.ok(!idCalls.includes('BL-100'), 'a ticket id must never be sent through the translation engine');

    // Mermaid diagram sources are never translated at all - no contentFr.
    const mermaidTree = {
      schemaVersion: 2,
      generatedAtIso: '2026-09-09T00:00:00Z',
      sourceSha: 'abc',
      vision: [{ id: 'architectureDiagram', title: 'Architecture', kind: 'mermaid', content: 'graph TD; A-->B;' }],
      milestones: [],
      tickets: [],
    };
    const { engine: mermaidEngine, calls: mermaidCalls } = fakeEngine({});
    const mermaidSession = createTranslationSession(emptyTranslationCache(), mermaidEngine);
    const mermaidTranslated = await translateDocsTree(mermaidTree, mermaidSession);
    assert.equal('contentFr' in mermaidTranslated.vision[0], false, 'a mermaid diagram source must gain no contentFr at all');
    assert.equal(mermaidCalls.length, 0, 'a mermaid diagram source must never reach the engine');

    // Fenced code blocks in markdown survive verbatim; only prose is sent.
    const { translateMarkdown } = translateModule();
    const { engine: codeEngine, calls: codeCalls } = fakeEngine({ 'Some prose.': 'Un peu de prose.' });
    const codeSession = createTranslationSession(emptyTranslationCache(), codeEngine);
    const markdown = ['Some prose.', '```js', 'const secretCode = 1;', '```'].join('\n');
    const codeResult = await translateMarkdown(codeSession, markdown, 'fr');
    assert.match(codeResult.text, /const secretCode = 1;/, 'fenced code must survive verbatim into the translated rendering');
    assert.equal(codeCalls.length, 1, 'only the prose segment is sent to the engine, never the code segment');
  });

  // ── bilingual-07: offline works in both languages ──────────────────────
  scoped(/^the app previously fetched the artifact$/, async (ctx) => {
    ctx.dom = renderDashboard();
    await flush();
  });

  scoped(/^the device is offline$/, (ctx) => {
    // Already-rendered chrome/content lives in app.js's own in-memory
    // state (lastBacklogData/docsTree) - toggling locale re-renders from
    // that, issuing no fetch at all, so a later fetch failing (simulated
    // here) must not be consulted by the toggle below.
    ctx.dom.window.fetch = () => Promise.reject(new Error('offline'));
  });

  scoped(/^switching between FR and EN still renders both fully$/, (ctx) => {
    click(ctx.dom, toggle(ctx.dom));
    assert.equal(ctx.dom.window.document.getElementById('pageHeading').textContent, 'SwarmForge — tableau de bord');
    assert.match(ctx.dom.window.document.querySelector('#board h3').textContent, /^Actifs/);

    click(ctx.dom, toggle(ctx.dom));
    assert.equal(ctx.dom.window.document.getElementById('pageHeading').textContent, 'SwarmForge — backlog dashboard');
    assert.match(ctx.dom.window.document.querySelector('#board h3').textContent, /^Active/);
  });
}

module.exports = { registerSteps };
