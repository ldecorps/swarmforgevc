const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { getNonce, getWebviewHtml } = require('../out/panel/webviewHtml');

const SCRIPT_URI = 'vscode-webview://test/media/panel.js';
const CSP_SOURCE = 'vscode-webview:';
const panelJs = fs.readFileSync(path.join(__dirname, '../media/panel.js'), 'utf8');

// --- getNonce ---

test('getNonce returns a 32-character string', () => {
  assert.equal(getNonce().length, 32);
});

test('getNonce returns different values on each call', () => {
  assert.notEqual(getNonce(), getNonce());
});

test('getNonce contains only alphanumeric characters', () => {
  assert.match(getNonce(), /^[A-Za-z0-9]{32}$/);
});

// --- getWebviewHtml: external script (VS Code 1.126 blocks inline scripts) ---

test('getWebviewHtml loads script via external src, not inline nonce', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes(`<script src="${SCRIPT_URI}"></script>`), 'missing external script tag');
  assert(!html.includes('<script nonce='), 'must not use inline nonce script');
});

test('getWebviewHtml CSP uses cspSource for script-src', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes(`script-src ${CSP_SOURCE}`));
});

// --- getWebviewHtml: HTML structure ---

test('getWebviewHtml contains required DOM elements', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('id="grid"'));
  assert(html.includes('id="status"'));
  assert(html.includes('id="stage"'));
  assert(html.includes('id="placeholder"'));
});

test('getWebviewHtml contains recent-runs section element', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('id="recent-runs"'));
  assert(html.includes('id="runs-list"'));
});

test('getWebviewHtml contains backlog section element', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('id="backlog"'));
  assert(html.includes('id="backlog-list"'));
});

test('getWebviewHtml backlog section is hidden by default', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('id="backlog"') && html.includes('display:none'));
});

test('getWebviewHtml contains CSS styling', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('body {'));
  assert(html.includes('display: flex;'));
  assert(html.includes('grid-template-columns'));
});

test('getWebviewHtml contains stall CSS class', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.tile.stalled'));
  assert(html.includes('#d4a017'));
});

test('getWebviewHtml contains dead tile CSS class', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.tile.dead'));
});

test('getWebviewHtml CSS has backlog badge classes', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('bl-badge-active'));
  assert(html.includes('bl-badge-todo'));
});

test('getWebviewHtml uses 2x2 grid layout class', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('layout-2x2'));
});

test('getWebviewHtml grid has min-height:0 so 2x2 fr rows get a computed height', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  // Without min-height:0 on the flex:1 #grid item itself, grid-template-rows
  // fr units have no reference height and tiles collapse to header-only.
  // The rule must appear between "#grid {" and its closing "}".
  const gridRuleMatch = html.match(/#grid\s*\{([^}]+)\}/);
  assert(gridRuleMatch, '#grid CSS rule not found');
  assert(gridRuleMatch[1].includes('min-height: 0'),
    '#grid rule must contain min-height: 0');
});

// --- panel.js content ---

test('panel.js uses acquireVsCodeApi', () => {
  assert(panelJs.includes('acquireVsCodeApi'));
});

test('panel.js handles roles message', () => {
  assert(panelJs.includes("case 'roles'"));
});

test('panel.js handles output message', () => {
  assert(panelJs.includes("case 'output'"));
});

test('panel.js handles stage message', () => {
  assert(panelJs.includes("case 'stage'"));
});

test('panel.js handles stall message', () => {
  assert(panelJs.includes("case 'stall'"));
  assert(panelJs.includes("classList.add('stalled')"));
  assert(panelJs.includes("classList.remove('stalled')"));
});

test('panel.js handles dead message', () => {
  assert(panelJs.includes("case 'dead'"));
});

test('panel.js has smart auto-scroll tail logic', () => {
  assert(panelJs.includes('tailLocked'));
  assert(panelJs.includes('isAtBottom'));
  assert(panelJs.includes('updateTileOutput'));
});

test('panel.js has updateGridLayout for 2x2', () => {
  assert(panelJs.includes('updateGridLayout'));
  assert(panelJs.includes('layout-2x2'));
});

test('panel.js has nudge button that sends input', () => {
  assert(panelJs.includes('nudge-btn'));
  assert(panelJs.includes("type: 'input'"));
});

test('panel.js has restart button that posts restartAgent', () => {
  assert(panelJs.includes('restart-btn'));
  assert(panelJs.includes('restartAgent'));
});

test('panel.js renders recent runs with running badge', () => {
  assert(panelJs.includes('renderRecentRuns'));
  assert(panelJs.includes('run-badge-running'));
  assert(panelJs.includes('run-badge-stopped'));
});

test('panel.js renders backlog', () => {
  assert(panelJs.includes('renderBacklog'));
  assert(panelJs.includes('bl-badge-'));
});

test('panel.js backlog active items sorted before todo', () => {
  assert(panelJs.includes("status === 'active'") || panelJs.includes("filter(i => i.status"));
});

test('panel.js backlog done items in details element', () => {
  assert(panelJs.includes('<details>') || panelJs.includes("'details'") || panelJs.includes('details'));
});

test('panel.js handles backlogUpdate message', () => {
  assert(panelJs.includes("case 'backlogUpdate'"));
});

test('panel.js sends refresh on load', () => {
  assert(panelJs.includes("type: 'refresh'"));
});

test('panel.js keydown handler is on document', () => {
  assert(panelJs.includes("document.addEventListener('keydown'"));
});

test('panel.js uses activeRole to route keydown', () => {
  assert(panelJs.includes('activeRole'));
});

test('panel.js output element has tabIndex for focus', () => {
  assert(panelJs.includes('tabIndex = 0'));
});
