'use strict';

// BL-603: step handlers for "behaviour-trend series are published on the live
// Mini App console". Drives the testable module surface - the payload builder
// (extension/out/bridge/bridgeState.js) and the console document
// (extension/out/bridge/holisticUiHtml.js) - not a booted VS Code or a live
// browser. Compiled output only: run `npm run compile` in extension/ first.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');

function bridgeStateModule() {
  return require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeState.js'));
}

function registryModule() {
  return require(path.join(EXT_DIR, 'out', 'metrics', 'trendsBoardRegistry.js'));
}

function holisticUiModule() {
  return require(path.join(EXT_DIR, 'out', 'bridge', 'holisticUiHtml.js'));
}

function bridgeServerSource() {
  return fs.readFileSync(path.join(EXT_DIR, 'src', 'bridge', 'bridgeServer.ts'), 'utf8');
}

const FIXTURE_PREFIX = 'bl603-acceptance-';

// BL-971: a killed earlier run traps nothing, so sweep by prefix up front
// as well as removing this run's own fixture at the end.
function sweepStaleFixtures() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    }
  }
}

// BL-971: a fixture must not outlive the run that made it, and a run that is
// killed traps nothing - so every fixture is registered for removal at
// process exit as well as swept by prefix before the next one is made.
const liveFixtures = new Set();
let exitHookInstalled = false;

function removeFixture(dir) {
  liveFixtures.delete(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureFixture(ctx) {
  if (!ctx.bl603FixtureDir) {
    sweepStaleFixtures();
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.on('exit', () => {
        for (const dir of [...liveFixtures]) {
          try {
            removeFixture(dir);
          } catch {
            /* best effort on the way out */
          }
        }
      });
    }
    ctx.bl603FixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
    liveFixtures.add(ctx.bl603FixtureDir);
    ctx.bl603Cleanup = () => removeFixture(ctx.bl603FixtureDir);
  }
  return ctx.bl603FixtureDir;
}

const NOW_MS = Date.parse('2026-08-29T12:00:00.000Z');

function renderBoard(ctx) {
  const { buildTrendsBoardState } = bridgeStateModule();
  ctx.bl603Payload = buildTrendsBoardState(ensureFixture(ctx), NOW_MS, ctx.bl603Registry);
  return ctx.bl603Payload;
}

function seriesOnBoard(ctx, id) {
  const match = (ctx.bl603Payload.series || []).find((s) => s.id === id);
  if (!match) {
    const present = (ctx.bl603Payload.series || []).map((s) => s.id).join(', ');
    throw new Error(`series ${id} has no place on the board; the board carries: ${present}`);
  }
  return match;
}

// Producers whose loaders read no source reader that has landed. Registering
// one still publishes it; it simply reads as no data yet.
function assertProducerModuleExists(producer) {
  const modulePath = path.join(EXT_DIR, 'src', 'metrics', producer);
  if (!fs.existsSync(modulePath)) {
    throw new Error(`producer module ${producer} does not exist at ${modulePath}`);
  }
}

const FEATURE_NAME = 'Behaviour-trend series are published on the live Mini App console';

function registerSteps(registry) {
  // BL-425 scoping: several of the step texts below are generic enough
  // that another ticket's feature legitimately uses the same words for
  // unrelated behaviour, and an unscoped registration resolves
  // first-match across every handler file - so an unscoped one here can
  // answer another feature's scenario with this ticket's context.
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);
  // ── Background ──────────────────────────────────────────────────────
  scoped(/^the live holistic console served over the bridge$/, (ctx) => {
    const html = holisticUiModule().getHolisticUiHtml();
    if (typeof html !== 'string' || html.length === 0) {
      throw new Error('expected the holistic console to render a document');
    }
    ctx.bl603Html = html;
  });

  scoped(/^a trends board registered on that console$/, (ctx) => {
    if (!ctx.bl603Html.includes('id="trendsBoard"')) {
      throw new Error('expected the console to carry the trendsBoard anchor');
    }
    // The board's data must come from the bridge, not be baked into the page.
    if (!ctx.bl603Html.includes("fetchJson('/trends')")) {
      throw new Error('expected the console to fetch its trends data from the bridge');
    }
  });

  // ── trends-published-on-mini-app-01 ─────────────────────────────────
  scoped(/^the series (\S+) produced by (\S+)$/, (ctx, series, producer) => {
    assertProducerModuleExists(producer);
    ctx.bl603Series = series;
    ctx.bl603Producer = producer;
  });

  scoped(/^the trends board is rendered$/, (ctx) => {
    renderBoard(ctx);
  });

  scoped(/^the board shows a plot for (\S+)$/, (ctx, series) => {
    const found = seriesOnBoard(ctx, series);
    if (typeof found.label !== 'string' || found.label.length === 0) {
      throw new Error(`series ${series} reached the board without a label`);
    }
    if (typeof found.hasData !== 'boolean') {
      throw new Error(`series ${series} reached the board without an explicit data state`);
    }
  });

  scoped(/^that plot was computed through the shared trend framework$/, (ctx) => {
    const found = seriesOnBoard(ctx, ctx.bl603Series);
    const trend = found.trend;
    // computeTrend's own result shape - every key it returns, present on
    // the payload. A hand-rolled plot would not carry all four summary
    // fields alongside the series.
    for (const key of ['series', 'currentValue', 'priorValue', 'delta', 'direction']) {
      if (!(key in trend)) {
        throw new Error(`series ${ctx.bl603Series} plot is missing computeTrend's ${key}`);
      }
    }
    if (!Array.isArray(trend.series)) {
      throw new Error(`series ${ctx.bl603Series} plot has no point series`);
    }
    const source = fs.readFileSync(path.join(EXT_DIR, 'src', 'bridge', 'bridgeState.ts'), 'utf8');
    if (!source.includes('computeTrend')) {
      throw new Error('the payload builder must compute through the shared computeTrend, not a local copy');
    }
  });

  // ── trends-published-on-mini-app-02 ─────────────────────────────────
  scoped(/^a registered series whose points are empty because (.+)$/, (ctx, cause) => {
    // Both causes reach the board the same way: a loader with nothing to
    // hand over. The first cannot even load its module; the second loads
    // fine and finds an empty ledger.
    const notLanded = cause.includes('has not landed');
    ctx.bl603Series = notLanded ? 'unlanded-producer' : 'landed-but-silent';
    ctx.bl603Registry = [
      {
        id: ctx.bl603Series,
        label: notLanded ? 'Unlanded producer' : 'Landed but silent',
        producer: notLanded ? 'notLanded.ts' : 'selfHealTelemetry.ts',
        loadPoints: notLanded
          ? () => {
              throw new Error('Cannot find module ./notLanded');
            }
          : () => [],
      },
    ];
  });

  scoped(/^that series reads as having no data yet$/, (ctx) => {
    const found = seriesOnBoard(ctx, ctx.bl603Series);
    if (found.hasData !== false) {
      throw new Error(`series ${ctx.bl603Series} claims to have data when its producer supplied none`);
    }
    if (!ctx.bl603Html.includes("noDataParagraph('no data yet')")) {
      throw new Error('expected the console to say "no data yet" for a series with nothing to plot');
    }
  });

  scoped(/^the board draws no plotted point for it$/, (ctx) => {
    const found = seriesOnBoard(ctx, ctx.bl603Series);
    if (found.trend.series.length !== 0) {
      throw new Error(
        `series ${ctx.bl603Series} was given ${found.trend.series.length} fabricated point(s): ` +
          JSON.stringify(found.trend.series)
      );
    }
    for (const [key, expected] of [
      ['currentValue', null],
      ['priorValue', null],
      ['delta', null],
      ['direction', 'unknown'],
    ]) {
      if (found.trend[key] !== expected) {
        throw new Error(
          `series ${ctx.bl603Series} invented a ${key} of ${JSON.stringify(found.trend[key])} ` +
            `for an empty series; expected ${JSON.stringify(expected)}`
        );
      }
    }
  });

  scoped(/^the board renders without error$/, (ctx) => {
    if (!ctx.bl603Payload || !Array.isArray(ctx.bl603Payload.series)) {
      throw new Error('the board failed to render');
    }
    if (ctx.bl603Cleanup) {
      ctx.bl603Cleanup();
      ctx.bl603Cleanup = null;
      ctx.bl603FixtureDir = null;
    }
  });

  // ── trends-published-on-mini-app-03 ─────────────────────────────────
  scoped(/^it offers no control that mutates swarm or backlog state$/, (ctx) => {
    const html = ctx.bl603Html;
    const start = html.indexOf('function renderTrendsBoard');
    const end = html.indexOf('function renderBacklogBoard');
    if (start < 0 || end < 0 || end <= start) {
      throw new Error('could not locate the trends board renderer in the console document');
    }
    const board = html.slice(start, end);
    // Read-only means no write path EXISTS, not that writes are disabled.
    for (const token of ['<form', '<button', '<input', 'POST', 'PUT', 'DELETE', 'onclick', 'addEventListener', 'fetch(']) {
      if (board.includes(token)) {
        throw new Error(`the trends board carries a write/control path: ${token}`);
      }
    }
    // Nor does the board's own markup section carry a control.
    const sectionStart = html.indexOf('<h2>Behaviour trends</h2>');
    const sectionEnd = html.indexOf('</section>', sectionStart);
    const section = html.slice(sectionStart, sectionEnd);
    for (const token of ['<form', '<button', '<input', '<a ']) {
      if (section.includes(token)) {
        throw new Error(`the trends board section carries a control: ${token}`);
      }
    }
  });

  // ── trends-published-on-mini-app-04 ─────────────────────────────────
  scoped(/^the series (\S+) registered after the board was written$/, (ctx, series) => {
    const { TRENDS_BOARD_SERIES } = registryModule();
    ctx.bl603Series = series;
    ctx.bl603NewlyRegistered = series;
    ctx.bl603Registry = [
      ...TRENDS_BOARD_SERIES,
      {
        id: series,
        label: 'Tenth series',
        producer: 'tenthSeries.ts',
        loadPoints: () => [
          { periodStart: '2026-08-27T00:00:00.000Z', value: 3 },
          { periodStart: '2026-08-28T00:00:00.000Z', value: 4 },
        ],
      },
    ];
  });

  scoped(/^no exhaustive per-series list had to be edited to make it appear$/, (ctx) => {
    const found = seriesOnBoard(ctx, ctx.bl603NewlyRegistered);
    if (found.hasData !== true || found.trend.currentValue !== 4) {
      throw new Error('the newly registered series did not carry its own producer data through to the board');
    }
    // Neither the renderer nor the payload builder may name a series.
    const { registeredSeriesIds } = registryModule();
    for (const id of [...registeredSeriesIds(), ctx.bl603NewlyRegistered]) {
      if (ctx.bl603Html.includes("'" + id + "'")) {
        throw new Error(`the console renderer names series ${id}; registration alone must publish a series`);
      }
    }
    const builder = fs.readFileSync(path.join(EXT_DIR, 'src', 'bridge', 'bridgeState.ts'), 'utf8');
    for (const id of registeredSeriesIds()) {
      if (builder.includes("'" + id + "'")) {
        throw new Error(`the payload builder names series ${id}; it must map over the registry instead`);
      }
    }
  });

  // ── trends-published-on-mini-app-05 ─────────────────────────────────
  scoped(/^a request for the trends board data without a bridge token$/, (ctx) => {
    ctx.bl603ServerSource = bridgeServerSource();
  });

  scoped(/^the request is served$/, (ctx) => {
    if (!ctx.bl603ServerSource.includes("url === '/trends'")) {
      throw new Error('expected /trends to be served by the bridge');
    }
  });

  scoped(/^it is refused as unauthorised$/, (ctx) => {
    const source = ctx.bl603ServerSource;
    // /trends is a plain entry in buildJsonRoutes, which sits BEHIND the
    // generic bearer gate - it adds no bypass of its own. The public
    // no-bearer allowlist must not name it.
    const routeIndex = source.indexOf("url === '/trends'");
    const publicAllowlistIndex = source.indexOf('Public sideload APKs (no bearer)');
    if (routeIndex < 0) {
      throw new Error('/trends route not found');
    }
    if (publicAllowlistIndex >= 0 && routeIndex > publicAllowlistIndex) {
      throw new Error('/trends must not be registered after the public no-bearer allowlist');
    }
    if (!source.includes("buildTrendsBoardState(targetPath, nowMs)")) {
      throw new Error('/trends must compute its payload through the authed bridge state builder');
    }
  });

  scoped(/^no trend series is readable from the static backlog dashboard$/, (ctx) => {
    const { registeredSeriesIds } = registryModule();
    const pwaDir = path.join(EXT_DIR, '..', 'pwa');
    if (!fs.existsSync(pwaDir)) {
      return;
    }
    const ids = registeredSeriesIds();
    const stack = [pwaDir];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!/\.(js|html|json|css)$/.test(entry.name)) {
          continue;
        }
        const text = fs.readFileSync(full, 'utf8');
        if (text.includes('/trends')) {
          throw new Error(`the static PWA reaches the live trends endpoint from ${full}`);
        }
        for (const id of ids) {
          if (text.includes(id)) {
            throw new Error(`the static PWA carries trend series ${id} in ${full}`);
          }
        }
      }
    }
  });
}

module.exports = { registerSteps };
