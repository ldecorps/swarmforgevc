'use strict';

// BL-1153: sticky web UI font-size across Mini Apps and PWA dashboard.
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require(path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', 'jsdom'));
const { getResidentSpyUiHtml } = require('../../../extension/out/bridge/residentSpyUiHtml');
const { getPipelineGridUiHtml } = require('../../../extension/out/bridge/pipelineGridUiHtml');
const { getPausedPagerUiHtml } = require('../../../extension/out/bridge/pausedPagerUiHtml');
const { PANE_FONT_DEFAULT_PX } = require('../../../extension/out/bridge/residentSpyPaneFontSize');

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found');
  }
  return match[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeFontFetch(store) {
  return (url, opts) => {
    const href = String(url);
    if (href.startsWith('/web-ui-font-size') && (!opts || opts.method !== 'PUT')) {
      const surface = new URL(href, 'https://example.test').searchParams.get('surface');
      const fontSizePx = store[surface];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, surface, fontSizePx }),
      });
    }
    if (href.startsWith('/web-ui-font-size') && opts && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      store[body.surface] = body.fontSizePx;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, surface: body.surface, fontSizePx: body.fontSizePx }),
      });
    }
    return Promise.reject(new Error('unexpected fetch: ' + href));
  };
}

async function driveLiveScreenReload(store) {
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.test/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  dom.window.fetch = (url, opts) => {
    const href = String(url);
    if (href.startsWith('/resident-pane')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: true, monoRouterLayout: true, panes: [] }),
      });
    }
    return makeFontFetch(store)(url, opts);
  };
  dom.window.eval(extractInlineScript(html));
  await flush();
  return dom;
}

async function driveGridReload(store) {
  const html = getPipelineGridUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.test/pipeline-grid/?bearer=test-token',
    pretendToBeVisual: true,
  });
  dom.window.fetch = (url, opts) => {
    const href = String(url);
    if (href.startsWith('/pipeline-board')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ text: 'grid' }) });
    }
    return makeFontFetch(store)(url, opts);
  };
  dom.window.eval(extractInlineScript(html));
  await flush();
  return dom;
}

async function drivePausedReload(store) {
  const html = getPausedPagerUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.test/paused-pager/?bearer=test-token',
    pretendToBeVisual: true,
  });
  dom.window.fetch = (url, opts) => {
    const href = String(url);
    if (href.startsWith('/paused-pager-state')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], total: 0 }) });
    }
    return makeFontFetch(store)(url, opts);
  };
  dom.window.eval(extractInlineScript(html));
  await flush();
  return dom;
}

function closeDom(dom) {
  if (dom && dom.window && !dom.window.closed) {
    dom.window.close();
  }
}

function registerSteps(registry) {
  registry.define(/^the operator can open the Live Screen Mini App$/, () => {});
  registry.define(/^the operator can open the Pipeline Board Mini App$/, () => {});
  registry.define(/^the operator can open the Paused pager Mini App$/, () => {});
  registry.define(/^the operator can open the PWA dashboard$/, () => {});

  registry.define(/^the Live Screen pane font size is set to a non-default value within its clamp$/, async (ctx) => {
    ctx.bl1153 = ctx.bl1153 || {};
    ctx.bl1153.store = { 'live-screen': 16 };
  });

  registry.define(/^the Mini App is fully reloaded$/, async (ctx) => {
    if (ctx.bl1153 && ctx.bl1153.liveDom) {
      ctx.bl1153.liveDom.window.close();
    }
    ctx.bl1153.liveDom = await driveLiveScreenReload(ctx.bl1153.store);
  });

  registry.define(/^the pane text renders at that chosen size$/, (ctx) => {
    const px = ctx.bl1153.liveDom.window.document.documentElement.style
      .getPropertyValue('--pane-font-size')
      .trim();
    assert.equal(px, '16px');
  });

  registry.define(/^it does not reset to the BL-609 default of 13px$/, (ctx) => {
    const px = ctx.bl1153.liveDom.window.document.documentElement.style
      .getPropertyValue('--pane-font-size')
      .trim();
    assert.notEqual(px, `${PANE_FONT_DEFAULT_PX}px`);
    closeDom(ctx.bl1153.liveDom);
  });

  registry.define(/^the "([^"]+)" text size is set to a non-default value within its clamp$/, (ctx, surface) => {
    ctx.bl1153 = ctx.bl1153 || {};
    ctx.bl1153.store = ctx.bl1153.store || {};
    if (surface === 'Pipeline Board') {
      ctx.bl1153.store['pipeline-grid'] = 19;
      ctx.bl1153.surfaceKey = 'pipeline-grid';
      ctx.bl1153.cssVar = '--pg-font-px';
      ctx.bl1153.expected = '19px';
    } else {
      ctx.bl1153.store['paused-pager'] = 19;
      ctx.bl1153.surfaceKey = 'paused-pager';
      ctx.bl1153.cssVar = '--pp-font-px';
      ctx.bl1153.expected = '19px';
    }
  });

  registry.define(/^that page is fully reloaded$/, async (ctx) => {
    if (ctx.bl1153.surfaceKey === 'pipeline-grid') {
      if (ctx.bl1153.gridDom) ctx.bl1153.gridDom.window.close();
      ctx.bl1153.gridDom = await driveGridReload(ctx.bl1153.store);
      ctx.bl1153.activeDom = ctx.bl1153.gridDom;
    } else {
      if (ctx.bl1153.pausedDom) ctx.bl1153.pausedDom.window.close();
      ctx.bl1153.pausedDom = await drivePausedReload(ctx.bl1153.store);
      ctx.bl1153.activeDom = ctx.bl1153.pausedDom;
    }
  });

  registry.define(/^the text renders at that chosen size$/, (ctx) => {
    const px = ctx.bl1153.activeDom.window.document.documentElement.style
      .getPropertyValue(ctx.bl1153.cssVar)
      .trim();
    assert.equal(px, ctx.bl1153.expected);
    closeDom(ctx.bl1153.activeDom);
  });

  registry.define(/^the PWA dashboard font size is set via A-\/A\+$/, () => {});
  registry.define(/^the dashboard is reloaded$/, () => {});
  registry.define(/^the chosen size is restored from the preferences Cache as today$/, () => {});

  registry.define(
    /^the Live Screen, Pipeline Board, and Paused pager persist a font-size choice$/,
    () => {}
  );

  registry.define(/^the persistence mechanism is inspected$/, (ctx) => {
    ctx.bl1153 = ctx.bl1153 || {};
    ctx.bl1153.html = [
      getResidentSpyUiHtml(),
      getPipelineGridUiHtml(),
      getPausedPagerUiHtml(),
    ].join('\n');
  });

  registry.define(/^it does not rely on localStorage or sessionStorage in the webview$/, (ctx) => {
    assert.doesNotMatch(ctx.bl1153.html, /localStorage|sessionStorage/);
  });

  registry.define(
    /^it persists via the extension host \(workspace state or host-served preference file\) or an explicit recorded Rule-3 waiver$/,
    (ctx) => {
      assert.match(ctx.bl1153.html, /\/web-ui-font-size/);
    }
  );

  registry.define(/^the stored font-size preference for a surface is missing or corrupt$/, (ctx) => {
    ctx.bl1153 = { store: {} };
  });

  registry.define(/^that surface loads$/, async (ctx) => {
    ctx.bl1153.liveDom = await driveLiveScreenReload(ctx.bl1153.store);
  });

  registry.define(/^it uses that surface's existing default size$/, (ctx) => {
    const px = ctx.bl1153.liveDom.window.document.documentElement.style
      .getPropertyValue('--pane-font-size')
      .trim();
    assert.equal(px, `${PANE_FONT_DEFAULT_PX}px`);
    closeDom(ctx.bl1153.liveDom);
  });
}

module.exports = { registerSteps };
