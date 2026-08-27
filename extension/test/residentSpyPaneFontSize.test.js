'use strict';

const assert = require('node:assert/strict');
const {
  PANE_FONT_DEFAULT_PX,
  PANE_FONT_MIN_PX,
  PANE_FONT_MAX_PX,
  clampPaneFontSizePx,
  paneFontSizeAtBound,
  stepPaneFontSizePx,
} = require('../out/bridge/residentSpyPaneFontSize');

test('clampPaneFontSizePx accepts in-range values and rounds', () => {
  assert.equal(clampPaneFontSizePx(13), 13);
  assert.equal(clampPaneFontSizePx(13.4), 13);
  assert.equal(clampPaneFontSizePx(13.6), 14);
});

test('clampPaneFontSizePx clamps below minimum and above maximum', () => {
  assert.equal(clampPaneFontSizePx(PANE_FONT_MIN_PX - 5), PANE_FONT_MIN_PX);
  assert.equal(clampPaneFontSizePx(PANE_FONT_MAX_PX + 5), PANE_FONT_MAX_PX);
});

test('clampPaneFontSizePx falls back to the default for non-finite input', () => {
  assert.equal(clampPaneFontSizePx(Number.NaN), PANE_FONT_DEFAULT_PX);
  assert.equal(clampPaneFontSizePx(Number.POSITIVE_INFINITY), PANE_FONT_DEFAULT_PX);
});

test('stepPaneFontSizePx steps up and down by one pixel', () => {
  assert.equal(stepPaneFontSizePx(13, 1), 14);
  assert.equal(stepPaneFontSizePx(13, -1), 12);
});

test('stepPaneFontSizePx refuses to move past either bound', () => {
  assert.equal(stepPaneFontSizePx(PANE_FONT_MIN_PX, -1), PANE_FONT_MIN_PX);
  assert.equal(stepPaneFontSizePx(PANE_FONT_MAX_PX, 1), PANE_FONT_MAX_PX);
});

test('paneFontSizeAtBound reports both edges', () => {
  assert.equal(paneFontSizeAtBound(PANE_FONT_MIN_PX, 'minimum'), true);
  assert.equal(paneFontSizeAtBound(PANE_FONT_MAX_PX, 'maximum'), true);
  assert.equal(paneFontSizeAtBound(PANE_FONT_DEFAULT_PX, 'minimum'), false);
  assert.equal(paneFontSizeAtBound(PANE_FONT_DEFAULT_PX, 'maximum'), false);
});
