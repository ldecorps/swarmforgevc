'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  computeOperatorDocsIndex,
  markdownToOperatorDocsHtml,
  parseDocsIndexSections,
  buildOperatorDocsPagePayload,
  isSafeDocsRelativePath,
  operatorDocsRoutesAreReadOnly,
  OPERATOR_DOCS_READ_ROUTE_PATHS,
} = require('../out/bridge/operatorDocsCore');

const REPO_ROOT = path.join(__dirname, '..', '..');

test('parseDocsIndexSections lists the four Divio sections from docs/index.md', () => {
  const indexContent = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'index.md'), 'utf8');
  const sections = parseDocsIndexSections(indexContent);
  assert.equal(sections.length, 4);
  assert.deepEqual(
    sections.map((section) => section.mode),
    ['tutorials', 'how-to', 'reference', 'explanation']
  );
  for (const section of sections) {
    assert.ok(section.heading.length > 0);
    assert.ok(section.links.length > 0, `expected links under ${section.mode}`);
  }
});

test('computeOperatorDocsIndex includes BL-516 how-to and docs-tree reference fixtures', () => {
  const indexContent = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'index.md'), 'utf8');
  const payload = computeOperatorDocsIndex(indexContent);
  const howToLinks = payload.sections.find((section) => section.mode === 'how-to').links;
  const referenceLinks = payload.sections.find((section) => section.mode === 'reference').links;
  assert.ok(howToLinks.some((link) => link.path.includes('BL-516-operator-telegram-console.md')));
  assert.ok(referenceLinks.some((link) => link.path.includes('docs-tree-schema.md')));
});

test('markdownToOperatorDocsHtml renders headings paragraphs and code blocks as HTML', () => {
  const markdown = ['# Title', '', 'Body paragraph.', '', '```sh', 'echo hi', '```'].join('\n');
  const html = markdownToOperatorDocsHtml(markdown);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<p>Body paragraph\.<\/p>/);
  assert.match(html, /<pre><code>echo hi<\/code><\/pre>/);
  assert.ok(!html.includes('# Title'));
  assert.ok(!html.includes('```'));
});

test('buildOperatorDocsPagePayload renders a real how-to page without raw markdown leakage', () => {
  const markdown = fs.readFileSync(
    path.join(REPO_ROOT, 'docs', 'how-to', 'BL-516-operator-telegram-console.md'),
    'utf8'
  );
  const payload = buildOperatorDocsPagePayload(markdown, 'how-to/BL-516-operator-telegram-console.md');
  assert.match(payload.html, /<h1>/);
  assert.match(payload.html, /<p>/);
  assert.ok(!payload.html.includes('## Configure'));
});

test('buildOperatorDocsPagePayload renders a real reference page legibly', () => {
  const markdown = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'reference', 'docs-tree-schema.md'), 'utf8');
  const payload = buildOperatorDocsPagePayload(markdown, 'reference/docs-tree-schema.md');
  assert.match(payload.html, /<h1>/);
  assert.match(payload.html, /<p>|table|<ul>/);
  assert.ok(!payload.html.startsWith('# docs-tree'));
});

test('isSafeDocsRelativePath rejects traversal attempts', () => {
  assert.equal(isSafeDocsRelativePath('how-to/BL-516-operator-telegram-console.md'), true);
  assert.equal(isSafeDocsRelativePath('../backlog/active/BL-1.yaml'), false);
  assert.equal(isSafeDocsRelativePath('how-to/../../etc/passwd'), false);
});

test('operator docs routes are read-only GET surfaces only', () => {
  const methodsByPath = new Map([
    ['/operator-docs', new Set(['GET'])],
    ['/operator-docs-index', new Set(['GET'])],
    ['/operator-docs-page', new Set(['GET'])],
    ['/gate-answer', new Set(['POST'])],
  ]);
  assert.equal(operatorDocsRoutesAreReadOnly(methodsByPath), true);
  methodsByPath.set('/operator-docs-page', new Set(['GET', 'POST']));
  assert.equal(operatorDocsRoutesAreReadOnly(methodsByPath), false);
  assert.deepEqual([...OPERATOR_DOCS_READ_ROUTE_PATHS], [
    '/operator-docs',
    '/operator-docs-index',
    '/operator-docs-page',
  ]);
});
