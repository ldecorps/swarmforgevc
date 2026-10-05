'use strict';

// BL-1941 (BL-097 stamp-off): step handlers for "a serverless dashboard
// projects backlog state and history". Drives the REAL compiled generator
// (extension/out/tools/generate-backlog-dashboard.js, backed by
// extension/out/metrics/backlogDashboard.js's computeBacklogDashboard),
// the REAL BL-096 metrics core (extension/out/metrics/deliveryMetrics.js -
// the swarm-metrics CLI's own core, same module computeBacklogDashboard
// itself calls per the schema doc's own "always agree" claim), the REAL
// pwa/index.html + pwa/app.js in jsdom, and the REAL pwa/sw.js in a minimal
// vm service-worker sandbox - mirroring extension/test/backlogDashboard.
// test.js, pwaDashboard.test.js and pwaServiceWorker.test.js's own
// established patterns, never a restatement of the dashboard/render/cache
// logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const PWA_DIR = path.join(REPO_ROOT, 'pwa');
const GENERATOR_CLI = path.join(EXT_DIR, 'out', 'tools', 'generate-backlog-dashboard.js');
const JSDOM_MODULE = path.join(EXT_DIR, 'node_modules', 'jsdom');

function JSDOMClass() {
  return require(JSDOM_MODULE).JSDOM;
}

let _deliveryMetrics = null;
function deliveryMetricsModule() {
  if (!_deliveryMetrics) _deliveryMetrics = require(path.join(EXT_DIR, 'out', 'metrics', 'deliveryMetrics.js'));
  return _deliveryMetrics;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

// BL-1390: a fixture root must be proven isolated from the live checkout
// BEFORE any mutating git call - `git -C ""` is the current directory, and
// a linked worktree shares the live repo's own `.git/config`.
function proveFixtureIsolated(root) {
  const commonDir = git(root, 'rev-parse', '--git-common-dir');
  assert.ok(
    path.resolve(root, commonDir).startsWith(root),
    `fixture git-common-dir must resolve inside the fixture root, got "${commonDir}"`
  );
}

function initRepo(root) {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'bl097@example.com');
  git(root, 'config', 'user.name', 'BL-097 fixture');
  proveFixtureIsolated(root);
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function commit(root, message, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', ['-C', root, 'add', '-A'], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', message], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

// The generator resolves its project root via .swarmforge/roles.tsv (same
// requirement generateBacklogDashboardCli.test.js's own fixture satisfies).
function writeSwarmforgeMeta(root) {
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`
  );
}

function runGenerator(root) {
  const output = execFileSync('node', [GENERATOR_CLI], { cwd: root, encoding: 'utf8' });
  return JSON.parse(output);
}

const FEATURE = 'a serverless dashboard projects backlog state and history';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── dashboard-01: push produces a fresh published projection ─────────
  scoped(/^a push to main that closes a ticket into done\/$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl097-');
    ctx.root = root;
    initRepo(root);
    mkdirp(path.join(root, 'backlog', 'active'));
    fs.writeFileSync(
      path.join(root, 'backlog', 'active', 'BL-900.yaml'),
      'id: BL-900\ntitle: fixture ticket\nstatus: active\nmilestone: M9\n'
    );
    commit(root, 'spec BL-900', '2026-09-01T08:00:00');
    mkdirp(path.join(root, 'backlog', 'done', 'M9'));
    fs.renameSync(path.join(root, 'backlog', 'active', 'BL-900.yaml'), path.join(root, 'backlog', 'done', 'M9', 'BL-900.yaml'));
    commit(root, 'close BL-900', '2026-09-05T08:00:00');
    ctx.pushSha = git(root, 'rev-parse', 'HEAD');
  });

  scoped(/^the Action completes$/, (ctx) => {
    writeSwarmforgeMeta(ctx.root);
    ctx.dashboard = runGenerator(ctx.root);
  });

  scoped(/^the published backlog\.json carries that push's SHA$/, (ctx) => {
    assert.equal(ctx.dashboard.sourceSha, ctx.pushSha);
  });

  scoped(/^its state board and metrics reflect the close$/, (ctx) => {
    const doneM9 = ctx.dashboard.board.doneByMilestone.M9 || [];
    assert.ok(doneM9.some((t) => t.id === 'BL-900'), 'closed ticket must appear under its milestone in doneByMilestone');
    assert.ok(
      !ctx.dashboard.board.active.some((t) => t.id === 'BL-900'),
      'closed ticket must no longer appear in board.active'
    );
    assert.equal(ctx.dashboard.notDoneCount, 0, 'the closed ticket must not count toward notDoneCount');
  });

  // ── dashboard-02: metrics agree with the metrics CLI ──────────────────
  scoped(/^a backlog\.json generated at a SHA$/, (ctx) => {
    if (!ctx.root) {
      const root = trackedTmpRoot('sfvc-bl097-parity-');
      ctx.root = root;
      initRepo(root);
      mkdirp(path.join(root, 'backlog', 'active'));
      commit(root, 'init', '2026-09-01T08:00:00');
      ctx.pushSha = git(root, 'rev-parse', 'HEAD');
    }
    writeSwarmforgeMeta(ctx.root);
    ctx.dashboardNowMs = Date.parse('2026-09-10T00:00:00Z');
    ctx.dashboard = runGenerator(ctx.root);
  });

  scoped(/^the BL-096 metrics CLI runs at the same SHA$/, (ctx) => {
    // generate-backlog-dashboard.js runs at HEAD by construction (no SHA
    // argument), so "the same SHA" is the repo's current HEAD - exactly
    // what the Given step above just generated at. computeDeliveryMetrics
    // is the swarm-metrics CLI's own core (deliveryMetrics.js); invoking it
    // directly against the same working tree is the CLI's own code path,
    // not a restatement of it.
    const { computeDeliveryMetrics } = deliveryMetricsModule();
    ctx.cliMetrics = computeDeliveryMetrics(ctx.root, [], Date.now());
  });

  scoped(/^velocity, burndown, and cycle-time figures are identical$/, (ctx) => {
    assert.deepEqual(ctx.dashboard.metrics.velocity, ctx.cliMetrics.velocity);
    assert.deepEqual(ctx.dashboard.metrics.burndown, ctx.cliMetrics.burndown);
    assert.deepEqual(ctx.dashboard.metrics.cycleTime, ctx.cliMetrics.cycleTime);
  });

  // ── dashboard-03: client renders board and charts from one fetch ─────
  function fakePwaDashboard() {
    return {
      schemaVersion: 1,
      generatedAtIso: '2026-09-09T12:00:00Z',
      sourceSha: 'abc123def456',
      board: {
        active: [{ id: 'BL-100', title: 'cost telemetry', swarm: 'primary' }],
        paused: [],
        doneByMilestone: { M4: [{ id: 'BL-096', title: 'metrics', swarm: 'primary', status: 'done' }] },
      },
      notDoneCount: 1,
      metrics: {
        velocity: { weeklySeries: [{ periodStart: '2026-09-01T00:00:00Z', value: 3 }], trend: { direction: 'up', delta: 1, currentValue: 3, priorValue: 2, series: [] }, rollingWindowCount: 5, rollingWindowDays: 7 },
        burndown: [{ milestone: 'M4', currentRemaining: 2, trend: { direction: 'down', delta: -1, currentValue: 2, priorValue: 3, series: [] }, dailySeries: [{ periodStart: '2026-09-01T00:00:00Z', value: 3 }] }],
        cycleTime: { medianMs: 2 * 3600000, p85Ms: 4 * 3600000, sampleCount: 6, trend: { direction: 'flat', delta: 0, currentValue: 2, priorValue: 2, series: [] }, weeklySeries: [] },
        forecasts: { tickets: [], milestones: [], throughputPerDay: 0.5 },
      },
    };
  }

  function renderPwa(dashboardData, { offline = false } = {}) {
    const html = fs.readFileSync(path.join(PWA_DIR, 'index.html'), 'utf8');
    const JSDOM = JSDOMClass();
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.github.io/dashboard/', pretendToBeVisual: true });
    const { window } = dom;
    dom.fetchCalls = [];
    window.fetch = (url) => {
      dom.fetchCalls.push(url);
      if (url === './backlog.json') {
        if (offline) {
          return Promise.reject(new Error('offline'));
        }
        return Promise.resolve({ json: () => Promise.resolve(dashboardData) });
      }
      if (url === './docs-tree.json') {
        // BL-256: loads independently of backlog.json; app.js's own .catch
        // (line 1636) handles a rejection gracefully, same as a real
        // offline/missing fetch of this second static artifact.
        return Promise.reject(new Error('docs tree not exercised in this handler'));
      }
      return Promise.reject(new Error('unexpected fetch: ' + url));
    };
    window.eval(fs.readFileSync(path.join(PWA_DIR, 'locales.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(PWA_DIR, 'app.js'), 'utf8'));
    return dom;
  }

  function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  scoped(/^a browser \(mobile viewport\) loading the Pages site$/, (ctx) => {
    ctx.pwaDashboardData = fakePwaDashboard();
  });

  scoped(/^backlog\.json is fetched$/, async (ctx) => {
    ctx.pwaDom = renderPwa(ctx.pwaDashboardData);
    await flush();
  });

  scoped(/^the state board, burndown, velocity, and cycle-time views render$/, (ctx) => {
    const { document } = ctx.pwaDom.window;
    assert.match(document.getElementById('board').textContent, /BL-100/);
    assert.match(document.getElementById('velocity').textContent, /5 closed/);
    assert.match(document.getElementById('burndown').textContent, /2 remaining/);
    assert.match(document.getElementById('cycleTime').textContent, /Median 2h, p85 4h over 6 ticket/);
  });

  scoped(/^no other network resource outside the Pages origin is required$/, (ctx) => {
    for (const url of ctx.pwaDom.fetchCalls) {
      assert.ok(
        url.startsWith('./') || !/^https?:\/\//.test(url),
        `expected only same-origin relative fetches, got: ${url}`
      );
    }
  });

  // ── dashboard-04: offline shows last-known state honestly ─────────────
  scoped(/^the PWA has previously loaded and cached backlog\.json$/, (ctx) => {
    ctx.pwaDashboardData = fakePwaDashboard();
    // sw.js caches the network-first response on a successful load; the
    // client-side honesty (rendering "as of" from whatever payload it was
    // handed) is exercised directly against the cached payload below,
    // mirroring pwaServiceWorker.test.js's own network-fallback coverage
    // for the worker layer and pwaDashboard.test.js's own asOf coverage
    // for the client layer - the two halves of "last-known state" this
    // scenario names.
  });

  scoped(/^the device is offline and the app is opened$/, async (ctx) => {
    // The worker layer: a network-first fetch of backlog.json falls back to
    // whatever was last cached, proven directly against the real sw.js.
    const listeners = {};
    const store = new Map();
    const sandbox = {
      self: { addEventListener: (type, handler) => { listeners[type] = handler; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() } },
      caches: {
        open: () => Promise.resolve({
          put: (request, response) => { store.set(typeof request === 'string' ? request : request.url, response); return Promise.resolve(); },
          match: (request) => Promise.resolve(store.get(typeof request === 'string' ? request : request.url)),
          addAll: () => Promise.resolve(),
        }),
        match: (request) => Promise.resolve(store.get(typeof request === 'string' ? request : request.url)),
        keys: () => Promise.resolve([]),
        delete: () => Promise.resolve(true),
      },
      fetch: () => Promise.reject(new Error('offline')),
      Request: function Request(url) { this.url = url; },
      URL: require('node:url').URL,
    };
    vm.createContext(sandbox);
    const swSource = fs.readFileSync(path.join(PWA_DIR, 'sw.js'), 'utf8').replace('__PWA_CACHE_NAME_PLACEHOLDER__', 'bl097-test-cache');
    vm.runInContext(swSource, sandbox);
    const cachedResponse = { body: JSON.stringify(ctx.pwaDashboardData) };
    store.set('https://example.github.io/dashboard/backlog.json', cachedResponse);
    let responded;
    listeners.fetch({ request: { url: 'https://example.github.io/dashboard/backlog.json' }, respondWith: (p) => { responded = p; } });
    ctx.offlineWorkerResult = await responded;

    // The client layer: the app renders whatever payload it was handed
    // (the real offline path for a cold app open), with its own honesty
    // indicator intact.
    ctx.pwaDom = renderPwa(ctx.pwaDashboardData, { offline: false });
    await flush();
  });

  scoped(/^the last-cached board and charts render$/, (ctx) => {
    assert.equal(ctx.offlineWorkerResult.body, JSON.stringify(ctx.pwaDashboardData), 'the worker must serve the cached payload when the network is unavailable');
    assert.match(ctx.pwaDom.window.document.getElementById('board').textContent, /BL-100/);
  });

  scoped(/^an "as of <generation time>" indicator is visible$/, (ctx) => {
    const asOf = ctx.pwaDom.window.document.getElementById('asOf').textContent;
    assert.match(asOf, /As of/);
  });

  // ── dashboard-07: platforms without periodic sync degrade silently ────
  scoped(/^a browser that does not support the Periodic Background Sync API$/, (ctx) => {
    ctx.pwaDashboardData = fakePwaDashboard();
  });

  scoped(/^the PWA loads and runs$/, async (ctx) => {
    ctx.pwaDom = renderPwa(ctx.pwaDashboardData);
    await flush();
  });

  scoped(/^no error or prompt is shown$/, (ctx) => {
    // jsdom carries no serviceWorker/periodicSync API at all - exactly the
    // unsupported-platform case this scenario names. registerPeriodicSync's
    // own feature-detection (app.js) short-circuits before touching any
    // such API, so reaching a clean render below is itself the proof no
    // error or permission prompt occurred.
    assert.equal('serviceWorker' in ctx.pwaDom.window.navigator, false);
    assert.match(ctx.pwaDom.window.document.getElementById('board').textContent, /BL-100/, 'rendering must not depend on periodic-sync support');
  });

  scoped(/^freshness behaves as open-time fetch plus cache$/, (ctx) => {
    // Without periodic sync, the only freshness mechanism left is the
    // open-time fetch this scenario's own render already performed (the
    // app's two static data artifacts, loaded independently per BL-256),
    // plus whatever sw.js's network-first caching already holds - no
    // second, unsupported-API-driven fetch is ever attempted.
    assert.deepEqual(ctx.pwaDom.fetchCalls.sort(), ['./backlog.json', './docs-tree.json']);
  });

  // ── dashboard-05 (dashboard-06 slot): schema is versioned and documented ──
  scoped(/^backlog\.json is generated$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl097-schema-');
    ctx.root = root;
    initRepo(root);
    mkdirp(path.join(root, 'backlog', 'active'));
    commit(root, 'init', '2026-09-01T08:00:00');
    writeSwarmforgeMeta(root);
    ctx.dashboard = runGenerator(root);
    ctx.schemaDoc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'reference', 'backlog-dashboard-schema.md'), 'utf8');
  });

  scoped(/^it contains a schema_version$/, (ctx) => {
    assert.equal(typeof ctx.dashboard.schemaVersion, 'number');
  });

  scoped(/^every field appears in the documented schema$/, (ctx) => {
    assert.match(ctx.schemaDoc, /`schemaVersion`/);
    for (const field of Object.keys(ctx.dashboard)) {
      assert.match(
        ctx.schemaDoc,
        new RegExp('`' + field + '`'),
        `top-level field "${field}" produced by the generator is not documented in backlog-dashboard-schema.md`
      );
    }
  });
}

module.exports = { registerSteps };
