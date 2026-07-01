const assert = require('node:assert/strict');
const test = require('node:test');
const { extractPanelFunction } = require('./helpers/extractPanelFunction');

const isFirstRowRole = extractPanelFunction('isFirstRowRole');
const updateGridLayout = extractPanelFunction('updateGridLayout');

function makeMockGrid() {
  return {
    classList: {
      classes: [],
      remove(...items) { this.classes = this.classes.filter(c => !items.includes(c)); },
      add(...items) { this.classes.push(...items); }
    }
  };
}

test('isFirstRowRole identifies coordinator as first-row', () => {
  assert.equal(isFirstRowRole('coordinator'), true);
});

test('isFirstRowRole identifies specifier as first-row', () => {
  assert.equal(isFirstRowRole('specifier'), true);
});

test('isFirstRowRole identifies other roles as not first-row', () => {
  assert.equal(isFirstRowRole('coder'), false);
  assert.equal(isFirstRowRole('cleaner'), false);
  assert.equal(isFirstRowRole('architect'), false);
  assert.equal(isFirstRowRole('hardener'), false);
  assert.equal(isFirstRowRole('documenter'), false);
  assert.equal(isFirstRowRole('QA'), false);
});

test('updateGridLayout applies layout-2x2 for 4 agents', () => {
  const mockGrid = makeMockGrid();
  global.grid = mockGrid;

  updateGridLayout(4, []);

  assert(mockGrid.classList.classes.includes('layout-2x2'));
  assert(!mockGrid.classList.classes.includes('layout-first-row'));
});

test('updateGridLayout applies layout-first-row when coordinator and specifier both present', () => {
  const mockGrid = makeMockGrid();
  global.grid = mockGrid;

  const roles = [
    { role: 'coordinator', displayName: 'Coordinator', agent: 'coordinator' },
    { role: 'specifier', displayName: 'Specifier', agent: 'specifier' },
    { role: 'coder', displayName: 'Coder', agent: 'coder' }
  ];

  updateGridLayout(3, roles);

  assert(!mockGrid.classList.classes.includes('layout-2x2'));
  assert(mockGrid.classList.classes.includes('layout-first-row'));
});

test('updateGridLayout does not apply first-row layout without coordinator', () => {
  const mockGrid = makeMockGrid();
  global.grid = mockGrid;

  const roles = [
    { role: 'coder', displayName: 'Coder', agent: 'coder' },
    { role: 'specifier', displayName: 'Specifier', agent: 'specifier' }
  ];

  updateGridLayout(2, roles);

  assert(!mockGrid.classList.classes.includes('layout-first-row'));
});

test('updateGridLayout does not apply first-row layout without specifier', () => {
  const mockGrid = makeMockGrid();
  global.grid = mockGrid;

  const roles = [
    { role: 'coordinator', displayName: 'Coordinator', agent: 'coordinator' },
    { role: 'coder', displayName: 'Coder', agent: 'coder' }
  ];

  updateGridLayout(2, roles);

  assert(!mockGrid.classList.classes.includes('layout-first-row'));
});

test('updateGridLayout clears a previously applied layout class when it no longer applies', () => {
  const mockGrid = makeMockGrid();
  global.grid = mockGrid;

  updateGridLayout(4, []);
  assert(mockGrid.classList.classes.includes('layout-2x2'));

  updateGridLayout(2, [{ role: 'coder' }]);
  assert(!mockGrid.classList.classes.includes('layout-2x2'));
  assert(!mockGrid.classList.classes.includes('layout-first-row'));
});

test('first-row tile class is added to coordinator tile', () => {
  const role = 'coordinator';
  const expectedClass = 'tile' + (isFirstRowRole(role) ? ' first-row' : '');
  assert.equal(expectedClass, 'tile first-row');
});

test('first-row tile class is added to specifier tile', () => {
  const role = 'specifier';
  const expectedClass = 'tile' + (isFirstRowRole(role) ? ' first-row' : '');
  assert.equal(expectedClass, 'tile first-row');
});

test('first-row tile class is not added to other roles', () => {
  const role = 'coder';
  const expectedClass = 'tile' + (isFirstRowRole(role) ? ' first-row' : '');
  assert.equal(expectedClass, 'tile');
});

test('getWebviewHtml CSS has layout-first-row styles', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('#grid.layout-first-row'));
  assert(html.includes('align-content: start'));
});

test('getWebviewHtml CSS has auto-fit flexible grid for layout-first-row', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('#grid.layout-first-row'));
  assert(html.includes('grid-template-columns: repeat(auto-fit'));
});

test('getWebviewHtml CSS has tile-output min-height for output retention', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('.tile-output'));
  assert(html.includes('min-height: 0'));
  assert(html.includes('flex: 1'));
});

test('getWebviewHtml CSS uses data-role selectors for coordinator and specifier sizing', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('[data-role="coordinator"]'));
  assert(html.includes('[data-role="specifier"]'));
  assert(html.includes('grid-column: span 2'));
});

test('getWebviewHtml CSS has flexible auto-fit grid for layout-first-row', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('#grid.layout-first-row'));
  assert(html.includes('repeat(auto-fit, minmax(280px, 1fr))'));
});

test('getWebviewHtml CSS uses role-based positioning instead of nth-of-type', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('[data-role="coordinator"]'));
  assert(!html.includes('#grid.layout-first-row .tile.first-row:nth-of-type(1)'));
});

test('getWebviewHtml CSS allows tiles to fit without scroll', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('#grid.layout-first-row'));
  assert(html.includes('overflow: hidden'));
});

test('getWebviewHtml CSS allows selected tiles to double in size', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('.tile.selected'));
  assert(html.includes('grid-column: span 2'));
  assert(html.includes('grid-row: span 2'));
});

test('updateGridLayout applies layout-first-row for 5 agents with coordinator and specifier', () => {
  const mockGrid = makeMockGrid();
  global.grid = mockGrid;

  const roles = [
    { role: 'coordinator', displayName: 'Coordinator', agent: 'coordinator' },
    { role: 'specifier', displayName: 'Specifier', agent: 'specifier' },
    { role: 'coder', displayName: 'Coder', agent: 'coder' },
    { role: 'cleaner', displayName: 'Cleaner', agent: 'cleaner' },
    { role: 'architect', displayName: 'Architect', agent: 'architect' }
  ];

  updateGridLayout(5, roles);

  assert(mockGrid.classList.classes.includes('layout-first-row'));
  assert(!mockGrid.classList.classes.includes('layout-2x2'));
});

test('updateGridLayout does not apply first-row layout when roles is undefined', () => {
  const mockGrid = makeMockGrid();
  global.grid = mockGrid;

  updateGridLayout(3, undefined);

  assert(!mockGrid.classList.classes.includes('layout-first-row'));
  assert(!mockGrid.classList.classes.includes('layout-2x2'));
});

test('updateGridLayout applies layout-first-row for 8 agents with coordinator and specifier', () => {
  const mockGrid = makeMockGrid();
  global.grid = mockGrid;

  const roles = [
    { role: 'coordinator', displayName: 'Coordinator', agent: 'coordinator' },
    { role: 'specifier', displayName: 'Specifier', agent: 'specifier' },
    { role: 'coder', displayName: 'Coder', agent: 'coder' },
    { role: 'cleaner', displayName: 'Cleaner', agent: 'cleaner' },
    { role: 'architect', displayName: 'Architect', agent: 'architect' },
    { role: 'hardender', displayName: 'Hardender', agent: 'hardender' },
    { role: 'documenter', displayName: 'Documenter', agent: 'documenter' },
    { role: 'QA', displayName: 'QA', agent: 'QA' }
  ];

  updateGridLayout(8, roles);

  assert(mockGrid.classList.classes.includes('layout-first-row'));
  assert(!mockGrid.classList.classes.includes('layout-2x2'));
});

test('getWebviewHtml CSS uses role-based positioning instead of nth-of-type for layout-first-row', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('[data-role="coordinator"]'));
  assert(html.includes('[data-role="specifier"]'));
});

test('getWebviewHtml CSS fits layout-first-row to panel without scroll', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  const ruleStart = html.indexOf('#grid.layout-first-row {');
  assert(ruleStart !== -1);
  const rule = html.slice(ruleStart, html.indexOf('}', ruleStart));
  assert(!rule.includes('overflow: auto'));
  assert(rule.includes('overflow: hidden'));
});

test('getWebviewHtml CSS weights coordinator and specifier larger in layout-first-row', () => {
  const { getWebviewHtml } = require('../out/panel/webviewHtml');
  const html = getWebviewHtml('test.js', 'test');
  assert(html.includes('[data-role="coordinator"]') || html.includes('.tile[data-role="coordinator"]'));
});

test('isFirstRowRole returns true for coordinator and specifier', () => {
  assert(isFirstRowRole('coordinator') === true);
  assert(isFirstRowRole('specifier') === true);
  assert(isFirstRowRole('coder') === false);
});
