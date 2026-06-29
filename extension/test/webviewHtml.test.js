const assert = require('node:assert/strict');
const test = require('node:test');
const { getNonce, getWebviewHtml } = require('../out/panel/webviewHtml');

test('getNonce returns a 32-character string', () => {
  const nonce = getNonce();
  assert.equal(nonce.length, 32);
});

test('getNonce returns different values on each call', () => {
  const nonce1 = getNonce();
  const nonce2 = getNonce();
  assert.notEqual(nonce1, nonce2);
});

test('getNonce contains only alphanumeric characters', () => {
  const nonce = getNonce();
  assert.match(nonce, /^[A-Za-z0-9]{32}$/);
});

test('getWebviewHtml includes the nonce in the CSP meta tag', () => {
  const nonce = 'test-nonce-value';
  const html = getWebviewHtml(nonce);
  assert(html.includes(`nonce-${nonce}`));
});

test('getWebviewHtml includes the nonce in the script tag', () => {
  const nonce = 'test-nonce-value';
  const html = getWebviewHtml(nonce);
  assert(html.includes(`<script nonce="${nonce}">`));
});

test('getWebviewHtml contains required DOM elements', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('id="grid"'));
  assert(html.includes('id="status"'));
  assert(html.includes('id="stage"'));
  assert(html.includes('id="placeholder"'));
});

test('getWebviewHtml contains CSS styling', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('body {'));
  assert(html.includes('display: flex;'));
  assert(html.includes('grid-template-columns'));
});

test('getWebviewHtml contains webview message handling script', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('acquireVsCodeApi'));
  assert(html.includes('case \'roles\''));
  assert(html.includes('case \'output\''));
  assert(html.includes('case \'stage\''));
});
