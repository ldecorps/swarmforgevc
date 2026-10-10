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

test('stripDraftMetaHeader returns the whole file unstripped when there is no --- line', () => {
  // Leads with a blank line on purpose: split-then-join alone would
  // reconstruct the original string byte-for-byte here (no --- means
  // slice(sep + 1) is slice(0), the whole array), so a mutant that skips
  // the early return and falls through to the leading-newline strip would
  // produce the SAME result as the guard firing unless that leading blank
  // line is present to be (wrongly) stripped.
  const md = ['', 'Meta line one', 'Meta line two', '', 'No separator here.'].join('\n');
  assert.equal(stripDraftMetaHeader(md), md);
});

test('stripDraftMetaHeader normalizes CRLF line endings before splitting', () => {
  const md = ['meta', '---', 'Windows body line'].join('\r\n');
  const body = stripDraftMetaHeader(md);
  assert.equal(body, 'Windows body line');
});

test('stripDraftMetaHeader requires the trimmed line to equal exactly ---', () => {
  const md = ['meta', '  ---  ', 'Trimmed separator body'].join('\n');
  const body = stripDraftMetaHeader(md);
  assert.equal(body, 'Trimmed separator body');
});

test('stripDraftMetaHeader strips every leading newline, not just the first, and only at the start', () => {
  // Two blank lines after the separator: the `+` quantifier must consume both.
  const multiLeading = ['meta', '---', '', '', 'Title line'].join('\n');
  assert.equal(stripDraftMetaHeader(multiLeading), 'Title line');

  // No leading blank line, but a blank line later in the body: the `^`
  // anchor must leave that later newline run untouched.
  const midBlank = ['meta', '---', 'Title line', '', 'Body line'].join('\n');
  assert.equal(stripDraftMetaHeader(midBlank), 'Title line\n\nBody line');
});

test('deriveArticleDraftTitle prefers first plain line after meta', () => {
  const body = ['', 'Sample Draft Working Title', '', '[Listen](https://example.com)', 'Story.'].join('\n');
  assert.equal(deriveArticleDraftTitle(body, 'DRAFT-linkedin-sample.md'), 'Sample Draft Working Title');
});

test('deriveArticleDraftTitle prefers a markdown heading over the first plain line', () => {
  const body = ['# Heading Title', '', 'Sample Draft Working Title', 'Story.'].join('\n');
  assert.equal(deriveArticleDraftTitle(body, 'DRAFT-linkedin-sample.md'), 'Heading Title');
});

test('deriveArticleDraftTitle falls back to the filename when no heading or plain line exists', () => {
  const body = ['', '[Listen](https://example.com)', '# ', ''].join('\n');
  assert.equal(deriveArticleDraftTitle(body, 'DRAFT-linkedin-fallback-name.md'), 'DRAFT-linkedin-fallback-name');
});

test('deriveArticleDraftTitle falls back to the full filename when it does not end in exactly .md', () => {
  const body = ['', '[Listen](https://example.com)', '# ', ''].join('\n');
  assert.equal(deriveArticleDraftTitle(body, 'DRAFT-linkedin-report.mdx'), 'DRAFT-linkedin-report.mdx');
});

test('deriveArticleDraftTitle trims surrounding whitespace off the chosen plain line', () => {
  const body = ['', '   Padded Working Title   ', 'Story.'].join('\n');
  assert.equal(deriveArticleDraftTitle(body, 'DRAFT-linkedin-sample.md'), 'Padded Working Title');
});

test('deriveArticleDraftTitle accepts a plain line that ends with # (only a leading # is excluded)', () => {
  const body = ['', 'Release notes #', '', 'Body.'].join('\n');
  assert.equal(deriveArticleDraftTitle(body, 'DRAFT-linkedin-sample.md'), 'Release notes #');
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

test('isSafeArticleDraftFilename rejects each escape term in isolation (empty, slash, backslash, dot-dot)', () => {
  // Each case trips exactly ONE arm of the `!file || .../('/')  || ('\\') ||
  // ('..')` guard with the other three false, so a mutant on any single arm
  // (dropped term, swapped &&/||, or a collapsed `false`) changes this case's
  // answer.
  assert.equal(isSafeArticleDraftFilename(''), false);
  assert.equal(isSafeArticleDraftFilename('DRAFT-linkedin-ep1/sibling.md'), false);
  assert.equal(isSafeArticleDraftFilename('DRAFT-linkedin-ep1\\sibling.md'), false);
  // '..' with no path separator at all: also proves the guard runs BEFORE
  // the regex test, since this string would otherwise match
  // ARTICLE_DRAFT_FILENAME_RE (`.` is an allowed character in the class).
  assert.equal(isSafeArticleDraftFilename('DRAFT-linkedin-ep..1.md'), false);
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

test('computeArticleDraftsIndex filters out an entry whose filename is unsafe', () => {
  // The readdir layer (buildArticleDraftsIndexState) already filters by
  // ARTICLE_DRAFT_FILENAME_RE before entries reach here, so this second,
  // independent filter is otherwise never exercised with a real unsafe
  // name reaching it.
  const payload = computeArticleDraftsIndex([
    { file: 'DRAFT-linkedin-safe.md', mtimeMs: 10, markdown: '---\n\nSafe Tune\n' },
    { file: '../DRAFT-linkedin-escape.md', mtimeMs: 99, markdown: '---\n\nEscape Tune\n' },
  ]);
  assert.deepEqual(payload.drafts.map((d) => d.file), ['DRAFT-linkedin-safe.md']);
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

test('article drafts routes flag PUT, PATCH and DELETE individually, not only POST', () => {
  for (const writeMethod of ['PUT', 'PATCH', 'DELETE']) {
    const methodsByPath = new Map([
      ['/article-drafts', new Set(['GET'])],
      ['/article-drafts-index', new Set(['GET'])],
      ['/article-drafts-page', new Set(['GET', writeMethod])],
    ]);
    assert.equal(
      articleDraftsRoutesAreReadOnly(methodsByPath),
      false,
      `expected ${writeMethod} alone to be flagged as a write method`
    );
  }
});

test('article drafts routes stay read-only when one route path is absent from the map entirely', () => {
  // Only two of the three ARTICLE_DRAFTS_READ_ROUTE_PATHS are present -
  // methodsByPath.get('/article-drafts-page') is undefined, exercising the
  // `if (!methods) { continue; }` branch rather than an empty Set.
  const methodsByPath = new Map([
    ['/article-drafts', new Set(['GET'])],
    ['/article-drafts-index', new Set(['GET'])],
  ]);
  assert.equal(articleDraftsRoutesAreReadOnly(methodsByPath), true);
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

test('buildArticleDraftsIndexState returns an empty list when the operator directory does not exist', () => {
  // No mkOperatorFixture() here on purpose: the project root exists but
  // .swarmforge/operator/ under it never does, exercising readdirSync's
  // own catch branch rather than an empty-but-real directory.
  const root = mkTmpDir('sfvc-article-drafts-core-noop-dir-');
  assert.deepEqual(buildArticleDraftsIndexState(root), { drafts: [] });
});

test('buildArticleDraftsIndexState skips a directory entry even when its name matches the draft pattern', () => {
  const { root, operatorDir } = mkOperatorFixture();
  fs.mkdirSync(path.join(operatorDir, 'DRAFT-linkedin-not-a-file.md'));
  fs.writeFileSync(path.join(operatorDir, 'DRAFT-linkedin-real.md'), '---\n\nReal entry\n');
  const state = buildArticleDraftsIndexState(root);
  assert.deepEqual(state.drafts.map((d) => d.file), ['DRAFT-linkedin-real.md']);
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

test('buildArticleDraftPageState refuses a url with no ? at all, even one shaped like a query string', () => {
  const { root, operatorDir } = mkOperatorFixture();
  // Planted so a mutant that forces the ternary's other branch (treating
  // "no ?" the same as "has a ? right at the start") would find a real,
  // matching draft here and WRONGLY succeed instead of refusing.
  fs.writeFileSync(path.join(operatorDir, 'DRAFT-linkedin-real.md'), '---\n\nReal entry\n');
  assert.deepEqual(buildArticleDraftPageState(root, 'file=DRAFT-linkedin-real.md'), {
    error: 'invalid draft file',
  });
});

test('buildArticleDraftPageState refuses a file value with malformed percent-encoding instead of throwing', () => {
  const { root } = mkOperatorFixture();
  assert.deepEqual(buildArticleDraftPageState(root, '/article-drafts-page?file=%'), {
    error: 'invalid draft file',
  });
});

