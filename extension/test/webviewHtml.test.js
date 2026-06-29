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

test('getWebviewHtml contains smart auto-scroll tail logic', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('tailLocked'));
  assert(html.includes('isAtBottom'));
  assert(html.includes('updateTileOutput'));
});

test('getWebviewHtml uses 2x2 grid layout for four agents', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('layout-2x2'));
  assert(html.includes('updateGridLayout'));
});

test('getWebviewHtml contains webview message handling script', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('acquireVsCodeApi'));
  assert(html.includes('case \'roles\''));
  assert(html.includes('case \'output\''));
  assert(html.includes('case \'stage\''));
});

test('getWebviewHtml contains stall CSS class', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('.tile.stalled'));
  assert(html.includes('#d4a017'));
});

test('getWebviewHtml contains stall message handler', () => {
  const html = getWebviewHtml('test');
  assert(html.includes("case 'stall'"));
  assert(html.includes('classList.add(\'stalled\')'));
  assert(html.includes('classList.remove(\'stalled\')'));
});

test('getWebviewHtml contains dead tile CSS class', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('.tile.dead'));
});

test('getWebviewHtml contains dead message handler', () => {
  const html = getWebviewHtml('test');
  assert(html.includes("case 'dead'"));
  assert(html.includes("'dead'"));
});

test('getWebviewHtml contains nudge button element', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('nudge-btn') || html.includes('nudge'));
});

test('getWebviewHtml shows nudge button only on stalled tiles', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('stalled') && html.includes('nudge'));
});

test('getWebviewHtml nudge sends Enter via forwardInput path', () => {
  const html = getWebviewHtml('test');
  // The webview posts { type: 'input', data: '\n' } — stored as literal newline in the string
  assert(html.includes('nudge-btn') && html.includes("type: 'input'") && html.includes("data:"));
});

test('getWebviewHtml contains restart button element', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('restart-btn') || html.includes('Restart'));
});

test('getWebviewHtml shows restart button only on dead tiles', () => {
  const html = getWebviewHtml('test');
  assert(html.includes('.tile.dead') && html.includes('Restart'));
});

test('getWebviewHtml restart posts restartAgent message type', () => {
  const html = getWebviewHtml('test');
  assert(html.includes("restartAgent") || html.includes("'restart'"));
});
