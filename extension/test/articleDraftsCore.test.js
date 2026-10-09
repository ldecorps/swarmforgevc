'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  stripDraftMetaHeader,
  deriveArticleDraftTitle,
  buildArticleDraftPagePayload,
  computeArticleDraftsIndex,
  isSafeArticleDraftFilename,
  articleDraftsRoutesAreReadOnly,
  ARTICLE_DRAFTS_READ_ROUTE_PATHS,
} = require('../out/bridge/articleDraftsCore');
const {
  buildArticleDraftsIndexState,
  buildArticleDraftPageState,
} = require('../out/bridge/articleDraftsHtml');

function mkOperatorFixture() {
  const root = mkTmpDir('sfvc-article-drafts-core-');
  const operatorDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(operatorDir, { recursive: true });
  return { root, operatorDir };
}

test('stripDraftMetaHeader drops the block above the first ---', () => {
  const md = ['# DRAFT — meta', 'Saved today.', '', '---', '', 'Ring Of Life', '', 'Body.'].join('\n');
  const body = stripDraftMetaHeader(md);
  assert.ok(!body.includes('DRAFT — meta'));
  assert.match(body, /^Ring Of Life/);
  assert.match(body, /Body\./);
});

test('deriveArticleDraftTitle prefers first plain line after meta', () => {
  const body = ['', 'Sample Draft Working Title', '', '[Listen](https://example.com)', 'Story.'].join('\n');
  assert.equal(deriveArticleDraftTitle(body, 'DRAFT-linkedin-sample.md'), 'Sample Draft Working Title');
});

test('buildArticleDraftPagePayload renders body without meta H1 leakage', () => {
  const md = [
    '# DRAFT — LinkedIn Sample — Sample Draft Working Title',
    'Saved for review.',
    '',
    '---',
    '',
    'Sample Draft Working Title',
    '',
    'Example subheading line',
    '',
    'Once the mail moves.',
  ].join('\n');
  const payload = buildArticleDraftPagePayload(md, 'DRAFT-linkedin-sample-draft.md');
  assert.equal(payload.title, 'Sample Draft Working Title');
  assert.match(payload.html, /Example subheading line/);
  assert.ok(!payload.html.includes('DRAFT — LinkedIn'));
  assert.ok(!payload.html.includes('Saved for review'));
  assert.match(payload.speechText, /Example subheading line/);
  assert.ok(!payload.speechText.includes('Saved for review'));
});

test('isSafeArticleDraftFilename rejects traversal and non-draft names', () => {
  assert.equal(isSafeArticleDraftFilename('DRAFT-linkedin-ep1-night.md'), true);
  assert.equal(isSafeArticleDraftFilename('../DRAFT-linkedin-ep1.md'), false);
  assert.equal(isSafeArticleDraftFilename('NOTE-linkedin.md'), false);
  assert.equal(isSafeArticleDraftFilename('DRAFT-linkedin-ep1/../x.md'), false);
});

test('computeArticleDraftsIndex sorts newest first', () => {
  const payload = computeArticleDraftsIndex([
    { file: 'DRAFT-linkedin-old.md', mtimeMs: 1, markdown: '---\n\nOld Tune\n' },
    { file: 'DRAFT-linkedin-new.md', mtimeMs: 99, markdown: '---\n\nNew Tune\n\nHello body.\n' },
  ]);
  assert.deepEqual(
    payload.drafts.map((d) => d.file),
    ['DRAFT-linkedin-new.md', 'DRAFT-linkedin-old.md']
  );
  assert.equal(payload.drafts[0].title, 'New Tune');
  assert.match(payload.drafts[0].speechText, /Hello body/);
});

test('article drafts routes are read-only GET surfaces only', () => {
  const methodsByPath = new Map([
    ['/article-drafts', new Set(['GET'])],
    ['/article-drafts-index', new Set(['GET'])],
    ['/article-drafts-page', new Set(['GET'])],
  ]);
  assert.equal(articleDraftsRoutesAreReadOnly(methodsByPath), true);
  methodsByPath.set('/article-drafts-page', new Set(['GET', 'POST']));
  assert.equal(articleDraftsRoutesAreReadOnly(methodsByPath), false);
  assert.deepEqual([...ARTICLE_DRAFTS_READ_ROUTE_PATHS], [
    '/article-drafts',
    '/article-drafts-index',
    '/article-drafts-page',
  ]);
});

test('buildArticleDraftsIndexState lists temp-fixture drafts newest first', () => {
  const { root, operatorDir } = mkOperatorFixture();
  fs.writeFileSync(path.join(operatorDir, 'DRAFT-linkedin-fixture-old.md'), '---\n\nOld fixture title\n');
  fs.writeFileSync(path.join(operatorDir, 'DRAFT-linkedin-fixture-new.md'), '---\n\nNew fixture title\n\nFixture body.\n');
  fs.writeFileSync(path.join(operatorDir, 'NOTE-fixture.md'), 'not a draft\n');
  const oldPath = path.join(operatorDir, 'DRAFT-linkedin-fixture-old.md');
  const newPath = path.join(operatorDir, 'DRAFT-linkedin-fixture-new.md');
  fs.utimesSync(oldPath, 1000, 1000);
  fs.utimesSync(newPath, 2000, 2000);
  const state = buildArticleDraftsIndexState(root);
  assert.deepEqual(state.drafts.map((d) => d.file), ['DRAFT-linkedin-fixture-new.md', 'DRAFT-linkedin-fixture-old.md']);
  assert.equal(state.drafts[0].title, 'New fixture title');
});

test('buildArticleDraftPageState refuses traversal and missing files', () => {
  const { root } = mkOperatorFixture();
  assert.deepEqual(buildArticleDraftPageState(root, '/article-drafts-page?file=../secret.md'), {
    error: 'invalid draft file',
  });
  assert.deepEqual(
    buildArticleDraftPageState(root, '/article-drafts-page?file=DRAFT-linkedin-does-not-exist-xyz.md'),
    { error: 'draft not found' }
  );
});

