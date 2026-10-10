'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { startBridge } = require('../out/bridge/bridgeServer');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');

const TOKEN = 'article-drafts-bridge-token';

function mkTmp() {
  const root = mkTmpDir('sfvc-article-drafts-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'operator', 'DRAFT-linkedin-ep-test-20261009.md'),
    ['# DRAFT — LinkedIn Ep test', 'meta only', '', '---', '', 'Test Tune Title', '', 'Hello draft body.'].join('\n')
  );
  return root;
}

function withBridge(targetPath, fn) {
  const letsTalk = { agentSession: createMockCursorBridgeAgentSession(targetPath) };
  return startBridge(targetPath, path.join(targetPath, 'runs.jsonl'), TOKEN, { letsTalk }).then(async (handle) => {
    try {
      return await fn(handle);
    } finally {
      handle.stop();
    }
  });
}

test('console menu includes the Article drafts button', async () => {
  const target = mkTmp();
  await withBridge(target, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/console`);
    const body = await res.text();
    assert.match(body, /Article drafts/);
    assert.match(body, /article-drafts/);
  });
});

test('article-drafts shell and JSON feeds serve the draft list and body', async () => {
  const target = mkTmp();
  await withBridge(target, async (handle) => {
    const shell = await fetch(`http://127.0.0.1:${handle.port}/article-drafts`);
    assert.equal(shell.status, 200);
    const shellHtml = await shell.text();
    assert.match(shellHtml, /Article drafts/);
    assert.match(shellHtml, /article-drafts-listen/);
    assert.match(shellHtml, /speechSynthesis/);

    const indexRes = await fetch(`http://127.0.0.1:${handle.port}/article-drafts-index?token=${TOKEN}`);
    assert.equal(indexRes.status, 200);
    const index = await indexRes.json();
    assert.equal(index.drafts.length, 1);
    assert.equal(index.drafts[0].title, 'Test Tune Title');
    assert.match(index.drafts[0].speechText, /Hello draft body/);

    const pageRes = await fetch(
      `http://127.0.0.1:${handle.port}/article-drafts-page?token=${TOKEN}&file=${encodeURIComponent(index.drafts[0].file)}`
    );
    assert.equal(pageRes.status, 200);
    const page = await pageRes.json();
    assert.equal(page.title, 'Test Tune Title');
    assert.match(page.html, /Hello draft body/);
    assert.match(page.speechText, /Hello draft body/);
    assert.ok(!page.html.includes('meta only'));
  });
});

test('ui-bundle offers article-drafts built-in page', async () => {
  const target = mkTmp();
  await withBridge(target, async (handle) => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/ui-bundle.json`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const manifest = await res.json();
    assert.ok(manifest.pages.some((p) => p.id === 'article-drafts' && p.entryPath === 'article-drafts'));
  });
});
