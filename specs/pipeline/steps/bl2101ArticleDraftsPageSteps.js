'use strict';

// BL-2101: step handlers for "the Article drafts page shows the Art
// Director's episode drafts" - the live Mini App page over
// .swarmforge/operator/DRAFT-linkedin-*.md (index + per-draft page,
// console menu link, ui-bundle entry, token-gated feeds).
//
// Drives buildArticleDraftsIndexState/buildArticleDraftPageState directly
// for scenarios 01-03, and a REAL bridge (startBridge) over a throwaway
// mkdtemp project for scenario 04 - the same shape articleDraftsBridge.test.js
// and bl1166OperatorDocsSteps.js use. Every fixture root is a
// trackedTmpRoot (BL-1636 standing guard) and is removed, with the bridge
// stopped, in a scenario-scoped disposable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-2101 The Article drafts page shows the Art Director's episode drafts";
const EXT = path.join(__dirname, '..', '..', '..', 'extension');

function loadArticleDraftsHtml() {
  return require(path.join(EXT, 'out', 'bridge', 'articleDraftsHtml'));
}

function loadBridgeServer() {
  return require(path.join(EXT, 'out', 'bridge', 'bridgeServer'));
}

function defaultDraftContent(filename) {
  return ['# meta', 'placeholder meta line', '', '---', '', `Title for ${filename}`, '', 'Body text.', ''].join('\n');
}

function nextMtimeMs(st) {
  st.mtimeCounter += 1000;
  return st.baseMtimeMs + st.mtimeCounter;
}

function writeDraftFile(st, filename, mtimeMs) {
  const full = path.join(st.operatorDir, filename);
  fs.writeFileSync(full, defaultDraftContent(filename));
  const seconds = mtimeMs / 1000;
  fs.utimesSync(full, seconds, seconds);
}

function ensure(ctx) {
  if (ctx.bl2101) {
    return ctx.bl2101;
  }
  const root = trackedTmpRoot('bl2101-article-drafts-');
  const operatorDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(operatorDir, { recursive: true });
  const st = {
    root,
    operatorDir,
    token: 'bl2101-test-token',
    mtimeCounter: 0,
    baseMtimeMs: Date.now() - 600000,
    indexResult: null,
    pageResult: null,
    handle: null,
    prevCursorApiKey: undefined,
  };
  ctx.bl2101 = st;
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(async () => {
    if (st.handle) {
      st.handle.stop();
      if (st.prevCursorApiKey === undefined) {
        delete process.env.CURSOR_API_KEY;
      } else {
        process.env.CURSOR_API_KEY = st.prevCursorApiKey;
      }
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  return st;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the operator directory holds the draft "DRAFT-linkedin-s1e1-first-20261001\.md" saved first$/, (ctx) => {
    const st = ensure(ctx);
    writeDraftFile(st, 'DRAFT-linkedin-s1e1-first-20261001.md', nextMtimeMs(st));
  });

  scoped(/^the operator directory holds the draft "DRAFT-linkedin-s1e2-second-20261009\.md" saved second$/, (ctx) => {
    const st = ensure(ctx);
    writeDraftFile(st, 'DRAFT-linkedin-s1e2-second-20261009.md', nextMtimeMs(st));
  });

  scoped(/^the operator directory holds the note "NOTE-linkedin-series\.md"$/, (ctx) => {
    const st = ensure(ctx);
    fs.writeFileSync(path.join(st.operatorDir, 'NOTE-linkedin-series.md'), 'Series planning notes, not a draft.\n');
  });

  scoped(/^the article drafts index is built$/, (ctx) => {
    const st = ensure(ctx);
    const { buildArticleDraftsIndexState } = loadArticleDraftsHtml();
    st.indexResult = buildArticleDraftsIndexState(st.root);
  });

  scoped(/^it lists "([^"]+)" then "([^"]+)"$/, (ctx, first, second) => {
    const st = ensure(ctx);
    assert.deepEqual(st.indexResult.drafts.map((d) => d.file), [first, second]);
  });

  scoped(/^it does not list "([^"]+)"$/, (ctx, excluded) => {
    const st = ensure(ctx);
    assert.ok(!st.indexResult.drafts.some((d) => d.file === excluded));
  });

  scoped(
    /^the draft "([^"]+)" has the meta line "([^"]+)" above its first "---" line and the line "([^"]+)" below it$/,
    (ctx, file, metaLine, bodyLine) => {
      const st = ensure(ctx);
      const content = [metaLine, '', '---', '', bodyLine, ''].join('\n');
      fs.writeFileSync(path.join(st.operatorDir, file), content);
    }
  );

  scoped(/^the page for the draft "([^"]+)" is built$/, (ctx, file) => {
    const st = ensure(ctx);
    const { buildArticleDraftPageState } = loadArticleDraftsHtml();
    st.pageResult = buildArticleDraftPageState(st.root, '/article-drafts-page?file=' + encodeURIComponent(file));
  });

  scoped(/^its title is "([^"]+)"$/, (ctx, title) => {
    const st = ensure(ctx);
    assert.ok(!st.pageResult.error, `expected a successful page build, got error: ${st.pageResult.error}`);
    assert.equal(st.pageResult.title, title);
  });

  scoped(/^its page does not contain "([^"]+)"$/, (ctx, text) => {
    const st = ensure(ctx);
    assert.ok(!st.pageResult.error, `expected a successful page build, got error: ${st.pageResult.error}`);
    assert.ok(!st.pageResult.html.includes(text));
    assert.ok(!(st.pageResult.speechText || '').includes(text));
  });

  scoped(/^it is refused with "([^"]+)"$/, (ctx, error) => {
    const st = ensure(ctx);
    assert.equal(st.pageResult.error, error);
  });

  scoped(/^the bridge is started on the operator directory's project$/, async (ctx) => {
    const st = ensure(ctx);
    const { startBridge } = loadBridgeServer();
    const prevKey = process.env.CURSOR_API_KEY;
    st.prevCursorApiKey = prevKey;
    process.env.CURSOR_API_KEY = prevKey || 'bl2101-test-key';
    st.handle = await startBridge(st.root, path.join(st.root, 'runs.jsonl'), st.token, {});
  });

  scoped(/^the console menu links "([^"]+)"$/, async (ctx, routePath) => {
    const st = ensure(ctx);
    const res = await fetch(`http://127.0.0.1:${st.handle.port}/console`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes(routePath), `expected console menu body to include ${routePath}`);
  });

  scoped(/^the Mini App page bundle lists the page "([^"]+)"$/, async (ctx, pageId) => {
    const st = ensure(ctx);
    const res = await fetch(`http://127.0.0.1:${st.handle.port}/lets-talk/ui-bundle.json`, {
      headers: { authorization: `Bearer ${st.token}` },
    });
    assert.equal(res.status, 200);
    const manifest = await res.json();
    assert.ok(manifest.pages.some((p) => p.id === pageId), `expected ui-bundle to list page ${pageId}`);
  });

  scoped(/^"\/article-drafts-index" answers the draft list to a request carrying the bridge token$/, async (ctx) => {
    const st = ensure(ctx);
    const res = await fetch(`http://127.0.0.1:${st.handle.port}/article-drafts-index?token=${st.token}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.drafts));
    assert.ok(body.drafts.length >= 1);
  });

  scoped(/^"\/article-drafts-index" refuses a request without the bridge token$/, async (ctx) => {
    const st = ensure(ctx);
    const res = await fetch(`http://127.0.0.1:${st.handle.port}/article-drafts-index`);
    assert.ok(res.status === 401 || res.status === 403, `expected 401/403 without a token, got ${res.status}`);
  });
}

module.exports = { registerSteps };
