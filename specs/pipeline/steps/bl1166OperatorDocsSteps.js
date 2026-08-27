'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = 'Bubble Operator docs index and first readable pages';
const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TOKEN = 'bl1166-token';

function loadOut() {
  return {
    startBridge: require(path.join(EXT, 'out', 'bridge', 'bridgeServer')).startBridge,
    operatorDocsHtml: require(path.join(EXT, 'out', 'bridge', 'operatorDocsHtml')),
    operatorDocsCore: require(path.join(EXT, 'out', 'bridge', 'operatorDocsCore')),
    letsTalkRoutes: require(path.join(EXT, 'out', 'bridge', 'letsTalkRoutes')),
  };
}

function ensure(ctx) {
  if (!ctx.bl1166) {
    ctx.bl1166 = {
      root: REPO_ROOT,
      token: TOKEN,
    };
  }
  return ctx.bl1166;
}

async function withBridge(ctx, fn) {
  const st = ensure(ctx);
  const { startBridge } = loadOut();
  // BL-1166 architect bounce: headless bridge requires CURSOR_API_KEY; stub
  // disposable key for APS only (same posture as BL-915 steps).
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let handle;
  try {
    handle = await startBridge(st.root, path.join(st.root, 'runs.jsonl'), st.token, {});
    st.handle = handle;
    return await fn(handle);
  } finally {
    if (handle) {
      handle.stop();
      st.handle = null;
    }
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the bridge serves the Bubble UI bundle with BL-829 remote page host$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^docs index\.md lists tutorials how-to reference and explanation sections$/, (ctx) => {
    const { operatorDocsCore } = loadOut();
    const indexContent = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'index.md'), 'utf8');
    const sections = operatorDocsCore.parseDocsIndexSections(indexContent);
    ctx.bl1166Sections = sections;
    assert.equal(sections.length, 4);
    assert.deepEqual(
      sections.map((section) => section.mode),
      ['tutorials', 'how-to', 'reference', 'explanation']
    );
  });

  scoped(/^at least one how-to and one reference markdown page exist in the repo docs tree$/, (ctx) => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'docs', 'how-to', 'BL-516-operator-telegram-console.md')));
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'docs', 'reference', 'docs-tree-schema.md')));
    ctx.bl1166HowTo = 'how-to/BL-516-operator-telegram-console.md';
    ctx.bl1166Reference = 'reference/docs-tree-schema.md';
  });

  scoped(/^the Operator docs remote page is opened from the Bubble pager$/, (ctx) => {
    const { operatorDocsHtml, letsTalkRoutes } = loadOut();
    ctx.bl1166Html = operatorDocsHtml.getOperatorDocsUiHtml();
    ctx.bl1166Page = letsTalkRoutes.operatorDocs;
  });

  scoped(/^the page loads without requiring a laptop browser$/, (ctx) => {
    assert.match(ctx.bl1166Html, /viewport/);
    assert.match(ctx.bl1166Html, /operator-docs-index/);
    assert.match(ctx.bl1166Html, /overflow-x:\s*hidden/);
  });

  scoped(/^the page title identifies operator authored documentation$/, (ctx) => {
    assert.match(ctx.bl1166Html, /Operator authored documentation/);
    assert.equal(ctx.bl1166Page.title, 'Operator docs');
  });

  scoped(/^the Operator docs index is rendered$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const response = await fetch(`http://127.0.0.1:${handle.port}/operator-docs-index`, {
        headers: authHeaders(TOKEN),
      });
      ctx.bl1166IndexStatus = response.status;
      ctx.bl1166IndexBody = await response.json();
    });
  });

  scoped(/^it lists tutorials how-to reference and explanation sections$/, (ctx) => {
    assert.equal(ctx.bl1166IndexStatus, 200);
    assert.deepEqual(
      ctx.bl1166IndexBody.sections.map((section) => section.mode),
      ['tutorials', 'how-to', 'reference', 'explanation']
    );
  });

  scoped(/^each section link drills to that section's page list derived from docs index\.md$/, (ctx) => {
    for (const section of ctx.bl1166IndexBody.sections) {
      assert.ok(Array.isArray(section.links));
      assert.ok(section.links.length > 0, `expected links for ${section.mode}`);
      for (const link of section.links) {
        assert.match(link.path, /^(tutorials|how-to|reference|explanation)\//);
      }
    }
  });

  scoped(/^the operator opens a listed how-to page from the Operator docs browser$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const response = await fetch(
        `http://127.0.0.1:${handle.port}/operator-docs-page?path=${encodeURIComponent(ctx.bl1166HowTo)}`,
        { headers: authHeaders(TOKEN) }
      );
      ctx.bl1166HowToStatus = response.status;
      ctx.bl1166HowToBody = await response.json();
      ctx.bl1166LatestPageStatus = ctx.bl1166HowToStatus;
      ctx.bl1166LatestPageBody = ctx.bl1166HowToBody;
    });
  });

  scoped(/^the response body is HTML not raw markdown source$/, (ctx) => {
    assert.equal(ctx.bl1166LatestPageStatus, 200);
    assert.match(ctx.bl1166LatestPageBody.html, /<h1>/);
    assert.ok(!ctx.bl1166LatestPageBody.html.includes('```'));
  });

  scoped(/^headings and paragraphs are legible at a phone viewport width$/, (ctx) => {
    const { operatorDocsHtml } = loadOut();
    const shellHtml = ctx.bl1166Html ?? operatorDocsHtml.getOperatorDocsUiHtml();
    assert.match(shellHtml, /max-width:\s*100/);
    assert.match(shellHtml, /overflow-wrap:\s*anywhere/);
    assert.ok(ctx.bl1166LatestPageBody && typeof ctx.bl1166LatestPageBody.html === 'string');
    assert.match(ctx.bl1166LatestPageBody.html, /<p>/);
  });

  scoped(/^the operator opens a listed reference page from the Operator docs browser$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const response = await fetch(
        `http://127.0.0.1:${handle.port}/operator-docs-page?path=${encodeURIComponent(ctx.bl1166Reference)}`,
        { headers: authHeaders(TOKEN) }
      );
      ctx.bl1166ReferenceStatus = response.status;
      ctx.bl1166ReferenceBody = await response.json();
      ctx.bl1166LatestPageStatus = ctx.bl1166ReferenceStatus;
      ctx.bl1166LatestPageBody = ctx.bl1166ReferenceBody;
    });
  });

  scoped(/^the Operator docs routes are enumerated at the parcel commit$/, (ctx) => {
    const { operatorDocsCore } = loadOut();
    ctx.bl1166Routes = [...operatorDocsCore.OPERATOR_DOCS_READ_ROUTE_PATHS];
  });

  scoped(/^none of them accept backlog git or operator store writes from the browser client$/, (ctx) => {
    const methodsByPath = new Map(ctx.bl1166Routes.map((routePath) => [routePath, new Set(['GET'])]));
    assert.ok(require(path.join(EXT, 'out', 'bridge', 'operatorDocsCore')).operatorDocsRoutesAreReadOnly(methodsByPath));
  });

  scoped(/^a client without a valid bridge token$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^it requests an authored docs HTML page$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const response = await fetch(`http://127.0.0.1:${handle.port}/operator-docs-page?path=${encodeURIComponent(ctx.bl1166HowTo)}`);
      ctx.bl1166UnauthorizedStatus = response.status;
      ctx.bl1166UnauthorizedBody = await response.text();
    });
  });

  scoped(/^the bridge refuses with an unauthorized or forbidden response$/, (ctx) => {
    assert.ok(ctx.bl1166UnauthorizedStatus === 401 || ctx.bl1166UnauthorizedStatus === 403);
  });

  scoped(/^no document body is served$/, (ctx) => {
    assert.ok(!ctx.bl1166UnauthorizedBody.includes('<h1>'));
    assert.ok(!ctx.bl1166UnauthorizedBody.includes('Configure the Bot'));
  });

  scoped(/^the bridge cannot serve the docs corpus$/, (ctx) => {
    ctx.bl1166MissingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1166-missing-'));
  });

  scoped(/^the Operator docs page is opened$/, (ctx) => {
    const { operatorDocsHtml } = loadOut();
    ctx.bl1166UnavailableHtml = operatorDocsHtml.getOperatorDocsUiHtml();
    ctx.bl1166UnavailableIndex = operatorDocsHtml.buildOperatorDocsIndexState(ctx.bl1166MissingRoot);
  });

  scoped(/^the page shows an unavailable state that names bridge reachability$/, (ctx) => {
    assert.match(ctx.bl1166UnavailableHtml, /Bridge reachability/);
    assert.match(ctx.bl1166UnavailableHtml, /Operator docs unavailable/);
    assert.ok(ctx.bl1166UnavailableIndex.error);
  });

  scoped(/^it does not present an empty corpus as if fully synced$/, (ctx) => {
    assert.ok(!ctx.bl1166UnavailableHtml.includes('All sections loaded'));
    assert.notEqual(ctx.bl1166UnavailableIndex.sections, []);
  });
}

module.exports = { registerSteps };
