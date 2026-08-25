#!/usr/bin/env node
// BL-347: test-only harness for the acceptance pipeline. Renders the REAL
// pwa/index.html + pwa/app.js in jsdom (mirroring render-suite-duration.js's
// own pattern - lives here, not specs/pipeline/, so its require('jsdom')
// resolves against this package's own node_modules) fed a provided
// backlog.json fixture, and prints the Role Leaderboard section's rendered
// state as JSON - lets BL-347's acceptance steps assert against the real
// markup/visibility instead of reimplementing the render in JS.
//
// Usage:
//   node render-role-leaderboard.js <backlog-json-path>
//   node render-role-leaderboard.js <backlog-json-path> collapse-reopen
//
// The second mode mirrors render-dashboard-collapsible-sections.js's own
// "reopen" mode (collapse, persist, reload from the persisted state) but
// fed THIS fixture (which actually carries roleLeaderboard data, unlike
// that script's own hardcoded empty fixture) so the section is genuinely
// visible and collapsible for role-leaderboard-surface-07's own scenario.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const [, , backlogPath, mode] = process.argv;
if (!backlogPath) {
  console.error('Usage: render-role-leaderboard.js <backlog-json-path> [collapse-reopen]');
  process.exit(1);
}
const backlog = JSON.parse(fs.readFileSync(backlogPath, 'utf8'));

const PWA_DIR = path.join(__dirname, '..', '..', 'pwa');
const APP_JS_SOURCE = fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8');
const CACHE_NAME_MATCH = APP_JS_SOURCE.match(/PREFERENCES_CACHE_NAME\s*=\s*'([^']+)'/);
if (!CACHE_NAME_MATCH) {
  throw new Error('render-role-leaderboard.js: could not find PREFERENCES_CACHE_NAME in pwa/app.js');
}
const CACHE_NAME = CACHE_NAME_MATCH[1];
const SECTION_COLLAPSE_KEY = './__section-collapsed-preference__';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
}

function renderDashboard(withCaches, fetchCalls) {
  const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
  if (withCaches) {
    installFakeCaches(dom);
  }
  dom.window.fetch = (url) => {
    if (fetchCalls) {
      fetchCalls.push(url);
    }
    if (url === './backlog.json') {
      return Promise.resolve({ json: () => Promise.resolve(backlog) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
  return dom;
}

function sectionBodyDisplay(dom) {
  const header = dom.window.document.querySelector('h2[data-i18n="roleLeaderboardHeading"]');
  const body = header.closest('section').querySelector('.section-body');
  return body.style.display;
}

if (mode === 'collapse-reopen') {
  const first = renderDashboard(true, null);
  flush()
    .then(() => {
      first.window.document.querySelector('h2[data-i18n="roleLeaderboardHeading"]').dispatchEvent(new first.window.Event('click'));
      return flush();
    })
    .then(() => first.window.caches.open(CACHE_NAME))
    .then((cache) => cache.match(SECTION_COLLAPSE_KEY))
    .then((stored) => stored.json())
    .then((persisted) => {
      const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
      const second = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
      installFakeCaches(second);
      second.window.fetch = (url) => {
        if (url === './backlog.json') {
          return Promise.resolve({ json: () => Promise.resolve(backlog) });
        }
        return Promise.reject(new Error('unexpected fetch: ' + url));
      };
      return second.window.caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(SECTION_COLLAPSE_KEY, new second.window.Response(JSON.stringify(persisted))))
        .then(() => {
          second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
          second.window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
          return flush().then(() => flush());
        })
        .then(() => {
          process.stdout.write(JSON.stringify({ bodyDisplayAfterReopen: sectionBodyDisplay(second) }));
        });
    });
} else {
  const fetchCalls = [];
  const dom = renderDashboard(false, fetchCalls);
  flush().then(() => {
    const document = dom.window.document;
    const section = document.getElementById('roleLeaderboardSection');
    process.stdout.write(
      JSON.stringify({
        hidden: section.style.display === 'none',
        text: document.getElementById('roleLeaderboard').textContent,
        fetchCalls,
      })
    );
  });
}
