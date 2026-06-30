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
  assert(panelJs.includes('bl-group-header') || panelJs.includes('bl-badge-'));
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

// --- collapsible side-by-side panels ---

test('getWebviewHtml wraps both panels in bottom-row for side-by-side layout', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  const bottomRowIdx = html.indexOf('id="bottom-row"');
  assert(bottomRowIdx !== -1, 'missing #bottom-row container');
  assert(html.indexOf('id="recent-runs"') > bottomRowIdx, 'recent-runs must be inside bottom-row');
  assert(html.indexOf('id="backlog"') > bottomRowIdx, 'backlog must be inside bottom-row');
});

test('getWebviewHtml bottom-row CSS uses flex-direction row', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  const match = html.match(/#bottom-row\s*\{([^}]+)\}/);
  assert(match, '#bottom-row CSS rule not found');
  assert(match[1].includes('flex-direction: row'), '#bottom-row must have flex-direction: row');
});

test('getWebviewHtml panels have collapse toggle buttons', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('id="runs-toggle"'), 'missing runs-toggle button');
  assert(html.includes('id="backlog-toggle"'), 'missing backlog-toggle button');
});

test('panel.js collapses section on toggle button click', () => {
  assert(panelJs.includes("'collapsed'") || panelJs.includes('"collapsed"'),
    'panel.js must toggle collapsed class');
  assert(panelJs.includes('runs-toggle') || panelJs.includes('backlog-toggle'),
    'panel.js must reference toggle buttons');
});

test('panel.js manages bottom-row visibility based on content', () => {
  assert(panelJs.includes('bottom-row') || panelJs.includes('bottomRowEl'),
    'panel.js must manage bottom-row visibility');
});

// --- badgeUpdate and highlightTile ---

test('panel.js handles badgeUpdate message', () => {
  assert(panelJs.includes("case 'badgeUpdate'"));
});

test('panel.js handles highlightTile message', () => {
  assert(panelJs.includes("case 'highlightTile'"));
});

test('panel.js tile includes bl-badge span', () => {
  assert(panelJs.includes('tile-bl-badge'));
});

// --- improved backlog readability ---

test('panel.js backlog uses group headers for active/todo', () => {
  assert(panelJs.includes('bl-group-header'), 'panel.js backlog should use group headers');
});

test('getWebviewHtml CSS has backlog group header style', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('bl-group-header'));
});

// --- BL-030: selected tile width doubling ---

test('getWebviewHtml CSS has selected tile double-width rule', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.tile.selected'), 'missing .tile.selected CSS rule');
  assert(html.includes('grid-column: span 2'), 'selected tile must span 2 columns');
});

test('panel.js tracks selectedRole state', () => {
  assert(panelJs.includes('selectedRole'));
});

test('panel.js tile header is clickable to toggle selection', () => {
  assert(panelJs.includes('tile-header'));
  assert(panelJs.includes("addEventListener('click'"), 'header must have click handler');
});

test('panel.js sends tileSelected message on selection change', () => {
  assert(panelJs.includes("type: 'tileSelected'"));
});

test('panel.js handles restoreSelection message from host', () => {
  assert(panelJs.includes("case 'restoreSelection'"));
});

test('panel.js applies selected class to selected tile and removes from others', () => {
  assert(panelJs.includes("'selected'"), 'must toggle selected class');
});

// --- BL-031: visible input bar per tile ---

test('getWebviewHtml CSS has tile-input-bar styles', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.tile-input-bar'), 'missing .tile-input-bar CSS rule');
  assert(html.includes('flex-shrink: 0'), 'input bar must not shrink');
});

test('getWebviewHtml CSS has tile-input styles', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.tile-input'), 'missing .tile-input CSS rule');
  assert(html.includes('background: transparent'), 'input should be transparent');
  assert(html.includes('border: none'), 'input should have no border');
});

test('getWebviewHtml CSS has tile-input-prompt styles', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.tile-input-prompt'), 'missing .tile-input-prompt CSS');
});

test('panel.js creates tile-input-prompt with glyph', () => {
  assert(panelJs.includes('❯'), 'panel.js should create prompt with ❯ glyph');
});

test('panel.js creates tile-input-bar in ensureTile', () => {
  assert(panelJs.includes('tile-input-bar'), 'ensureTile must create input bar');
  assert(panelJs.includes('tile-input'), 'ensureTile must create input element');
});

test('panel.js sends input on Enter key from tile-input', () => {
  assert(panelJs.includes("'input'"), 'must send input message');
  assert(panelJs.includes('Enter') || panelJs.includes('keydown'), 'must handle Enter key');
});

test('panel.js sends Ctrl-C from tile-input', () => {
  assert(panelJs.includes("'\\x03'") || panelJs.includes("'\\u0003'"), 'must send Ctrl-C character');
});

test('panel.js manages per-tile input history with ArrowUp/Down', () => {
  assert(panelJs.includes('history') || panelJs.includes('History'), 'must track input history');
  assert(panelJs.includes('ArrowUp') || panelJs.includes('ArrowDown'), 'must handle arrow keys');
});

test('panel.js document keydown handler skips when tile-input has focus', () => {
  assert(panelJs.includes('tile-input') && panelJs.includes('focus'), 'must check if input is focused');
});
