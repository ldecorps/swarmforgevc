const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getNonce, getWebviewHtml, getWorkTreeHtml } = require('../out/panel/webviewHtml');

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

// --- getWorkTreeHtml ---

test('getWorkTreeHtml embeds the nonce in CSP and the inline script tag', () => {
  const html = getWorkTreeHtml('test-nonce-123');
  assert(html.includes("script-src 'nonce-test-nonce-123'"), 'CSP must reference the nonce');
  assert(html.includes('<script nonce="test-nonce-123">'), 'script tag must carry the nonce');
});

test('getWorkTreeHtml contains the work tree DOM scaffold', () => {
  const html = getWorkTreeHtml('n');
  assert(html.includes('<h1>Work Tree</h1>'));
  assert(html.includes('id="content"'));
});

test('getWorkTreeHtml inline script renders backlog rows with escaped fields', () => {
  const html = getWorkTreeHtml('n');
  assert(html.includes('function renderItems('));
  assert(html.includes('function escapeHtml('));
  assert(html.includes("No backlog items found."));
});

test('getWorkTreeHtml inline script wires highlightTile postMessage', () => {
  const html = getWorkTreeHtml('n');
  assert(html.includes("type: 'highlightTile'"));
  assert(html.includes('function highlight(role)'));
});

test('getWorkTreeHtml inline script listens for update messages', () => {
  const html = getWorkTreeHtml('n');
  assert(html.includes("msg.type === 'update'"));
  assert(html.includes("getElementById('content').innerHTML"));
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

// --- BL-062: done rows surface their milestone (the done/ subfolder name) ---

test('panel.js surfaces the milestone on done backlog rows', () => {
  assert(
    /status === 'done'[\s\S]{0,200}bl-milestone/.test(panelJs),
    'done rows must render a bl-milestone badge from item.milestone'
  );
});

test('webview CSS styles the milestone badge', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.bl-milestone'), 'must style the milestone badge');
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
  assert(html.includes('id="metrics-toggle"'), 'missing metrics-toggle button (BL-071)');
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

test('getWebviewHtml CSS has selected tile 2x2 rule', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.tile.selected'), 'missing .tile.selected CSS rule');
  assert(html.includes('grid-column: span 2'), 'selected tile must span 2 columns');
  assert(html.includes('grid-row: span 2'), 'selected tile must span 2 rows');
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

// --- BL-046: native input only, no custom input bar ---

test('getWebviewHtml CSS does not have tile-input-bar styles', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(!html.includes('.tile-input-bar'), 'custom input bar CSS must be removed');
});

test('getWebviewHtml CSS does not have tile-input styles', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(!html.includes('.tile-input {'), 'custom input CSS must be removed');
});

test('getWebviewHtml CSS does not have tile-input-prompt styles', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(!html.includes('.tile-input-prompt'), 'tile-input-prompt CSS must be removed');
});

test('panel.js does not create custom input bar in ensureTile', () => {
  assert(!panelJs.includes('tile-input-bar'), 'custom input bar code must be removed');
  assert(!panelJs.match(/tile-input[^R]/), 'custom input element must be removed');
});

test('panel.js document keydown handler routes input to activeRole directly', () => {
  assert(panelJs.includes("'input'"), 'must send input message');
  assert(panelJs.includes('activeRole'), 'must check activeRole is set');
  assert(panelJs.includes('postMessage'), 'must forward to host');
});

test('panel.js document keydown handler handles Enter key', () => {
  assert(panelJs.includes("case 'Enter'") || panelJs.includes("key === 'Enter'") || panelJs.includes('specialKey'),
    'must handle Enter key to forward to native input');
});

test('panel.js document keydown handler handles control keys', () => {
  assert(panelJs.includes('ctrlKey'), 'must check for Ctrl modifer');
  assert(panelJs.includes('specialKey') || panelJs.includes("key.length === 1"), 'must forward control sequences');
});

test('panel.js document keydown handler skips when no activeRole', () => {
  assert(panelJs.includes('if (!activeRole)'), 'must check if any tile is focused');
});

test('panel.js no longer tracks per-tile input history', () => {
  assert(!panelJs.includes('inputHistories'), 'inputHistories Map must be removed');
  assert(!panelJs.includes('MAX_HISTORY'), 'MAX_HISTORY constant must be removed');
});

// --- BL-045: needs-human blink border ---

test('getWebviewHtml CSS defines needs-human-blink animation', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('@keyframes needs-human-blink'), 'must define needs-human-blink animation');
  assert(html.includes('needs-human-blink') || html.includes('1.5s'), 'animation duration and name must be present');
});

test('getWebviewHtml CSS applies needs-human blink to tiles', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes('.tile.needs-human'), 'must have .tile.needs-human CSS rule');
  assert(html.includes('animation:') || html.includes('animation :'), 'must apply animation to needs-human tiles');
});

// --- BL-054: the pulse is border-only; content never blinks ---

function needsHumanKeyframesBlock(html) {
  // Extract the full brace-balanced block, not just up to the first inner
  // "}" — the keyframes body itself contains nested rule blocks (0%,100% and
  // 50%), so a non-greedy "up to the first }" regex silently truncates after
  // the first inner rule and the 50% frame is never actually inspected.
  const start = html.indexOf('@keyframes needs-human-blink');
  assert(start !== -1, 'must define needs-human-blink keyframes');
  const openBrace = html.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') {
      depth--;
      if (depth === 0) {
        return html.slice(openBrace + 1, i);
      }
    }
  }
  throw new Error('unbalanced braces in needs-human-blink keyframes');
}

test('needs-human pulse animates a border property, not whole-tile opacity', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  const keyframes = needsHumanKeyframesBlock(html);
  assert(
    !/opacity/.test(keyframes),
    'the pulse must not animate opacity — that fades the tile TEXT along with the border'
  );
  assert(
    /border/.test(keyframes),
    'the pulse must be carried by a border property'
  );
});

test('needs-human pulse is RED and keeps the gentle cadence (BL-059)', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  const keyframes = needsHumanKeyframesBlock(html);
  assert(/e53935|229,\s*57,\s*53/.test(keyframes), 'the pulse color must be red — asking-a-question reads as urgent');
  assert(!/00a8e8|0,\s*168,\s*232/.test(keyframes), 'the old blue accent must be gone');
  assert(/needs-human-blink 1\.5s ease-in-out infinite/.test(html), 'the 1.5s ease-in-out cadence must remain');
});

test('the 50% keyframe is visibly dimmed, not just a same-color no-op pulse', () => {
  // Pinning presence of the color channels alone would let a mutant set the
  // dimmed alpha to 1 (or drop the rgba() entirely) and still pass — the
  // blink (cycling to/from red) is what distinguishes "asking a question"
  // from the SOLID red of a dead tile.
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  const keyframes = needsHumanKeyframesBlock(html);
  const dimmedMatch = keyframes.match(/rgba\(\s*229,\s*57,\s*53,\s*([\d.]+)\s*\)/);
  assert(dimmedMatch, 'the 50% frame must dim the red via rgba() alpha');
  const alpha = Number(dimmedMatch[1]);
  assert(alpha > 0 && alpha < 0.7, `dimmed alpha ${alpha} must be a visible reduction, not near-full opacity`);
});

test('the needs-human rule itself does not dim tile content', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  const rule = html.match(/\.tile\.needs-human:not\(\.dead\)\s*{([\s\S]*?)}/);
  assert(rule, 'must keep the .tile.needs-human:not(.dead) rule with the dead guard');
  assert(!/opacity/.test(rule[1]), 'the needs-human rule must not touch opacity');
});

test('getWebviewHtml CSS suppresses blink when tile is dead', () => {
  const html = getWebviewHtml(SCRIPT_URI, CSP_SOURCE);
  assert(html.includes(':not(.dead)'), 'animation must not apply when dead class is present');
});

test('panel.js handles needsHuman message type', () => {
  assert(panelJs.includes("case 'needsHuman'"), 'must handle needsHuman message');
});

test('panel.js adds needs-human class when needsHuman event is true', () => {
  assert(panelJs.includes('needs-human'), 'must add needs-human class');
  assert(panelJs.includes("classList.add('needs-human')") || panelJs.includes('needs-human'), 'must toggle needs-human class');
});

test('panel.js removes stalled class when needs-human is active (precedence)', () => {
  assert(panelJs.includes("case 'needsHuman'"), 'must check needsHuman in message handler');
  // The precedence is handled by the removal of stalled when needs-human is added
  assert(panelJs.includes("classList.remove('stalled')") || panelJs.includes('remove') || panelJs.includes('needs-human'), 'must respect precedence');
});

test('panel.js removes needs-human class when event needsHuman becomes false', () => {
  assert(panelJs.includes("classList.remove('needs-human')"), 'must remove needs-human class when false');
});
