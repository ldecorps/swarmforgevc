const assert = require('node:assert/strict');
const test = require('node:test');
const { extractPanelFunction } = require('./helpers/extractPanelFunction');

const measureTilePaneRows = extractPanelFunction('measureTilePaneRows');

function makeMockElement(pixelHeight, lineHeight, fontSize = '13px') {
  return {
    getBoundingClientRect() {
      return { height: pixelHeight };
    }
  };
}

function makeMockComputeStyle(lineHeight, fontSize = '13px') {
  return (el) => ({
    lineHeight,
    fontSize
  });
}

test('measureTilePaneRows calculates rows from pixel height and line height', () => {
  const mockOutput = makeMockElement(390);

  global.window = {
    getComputedStyle: makeMockComputeStyle('1.35')
  };

  const tile = { id: 'mock' };

  const rows = measureTilePaneRows(tile, mockOutput);

  assert.equal(rows, 22, 'should calculate 390 / (13 * 1.35) = 22 rows');
});

test('measureTilePaneRows returns null for null/undefined element', () => {
  assert.equal(measureTilePaneRows(null, null), null);
  assert.equal(measureTilePaneRows(null, {}), null);
  assert.equal(measureTilePaneRows({}, null), null);
});

test('measureTilePaneRows returns null when pixel height is 0', () => {
  const mockOutput = makeMockElement(0);
  global.window = {
    getComputedStyle: makeMockComputeStyle('1.35')
  };

  const rows = measureTilePaneRows({}, mockOutput);

  assert.equal(rows, null);
});

test('measureTilePaneRows returns null when pixel height is negative', () => {
  const mockOutput = makeMockElement(-10);
  global.window = {
    getComputedStyle: makeMockComputeStyle('1.35')
  };

  const rows = measureTilePaneRows({}, mockOutput);

  assert.equal(rows, null);
});

test('measureTilePaneRows handles line-height in pixels', () => {
  const mockOutput = makeMockElement(390);
  global.window = {
    getComputedStyle: (el) => ({
      lineHeight: '17.55px',
      fontSize: '13px'
    })
  };

  const rows = measureTilePaneRows({}, mockOutput);

  assert.equal(rows, 22, 'should calculate 390 / 17.55 = 22 rows');
});

test('measureTilePaneRows handles line-height as multiplier', () => {
  const mockOutput = makeMockElement(260);
  global.window = {
    getComputedStyle: (el) => ({
      lineHeight: '1.5',
      fontSize: '13px'
    })
  };

  const rows = measureTilePaneRows({}, mockOutput);

  assert.equal(rows, 13, 'should calculate 260 / (13 * 1.5) = 13 rows');
});

test('measureTilePaneRows handles line-height "normal" as 1.35 * font-size', () => {
  const mockOutput = makeMockElement(260);
  global.window = {
    getComputedStyle: (el) => ({
      lineHeight: 'normal',
      fontSize: '13px'
    })
  };

  const rows = measureTilePaneRows({}, mockOutput);

  assert.equal(rows, 14, 'should calculate 260 / (13 * 1.35) = 14 rows');
});

test('measureTilePaneRows returns at least 1 row for small pixel heights', () => {
  const mockOutput = makeMockElement(5);
  global.window = {
    getComputedStyle: makeMockComputeStyle('20px')
  };

  const rows = measureTilePaneRows({}, mockOutput);

  assert.equal(rows, 1, 'should return at least 1 row');
});
