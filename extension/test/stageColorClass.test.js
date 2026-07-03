const assert = require('node:assert/strict');
const test = require('node:test');
const { extractPanelFunction } = require('./helpers/extractPanelFunction');

// BL-077: one stable CSS class per pipeline stage, plus neutral classes for
// "queued" (promoted, unrouted) and "done", used by both the tile badge and
// the BACKLOG row chip so the same holder always renders the same class.
const stageColorClass = extractPanelFunction('stageColorClass');

const STAGES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

test('every pipeline stage gets its own stage-color class', () => {
  const classes = STAGES.map(stageColorClass);
  assert.equal(new Set(classes).size, STAGES.length, 'every stage must map to a distinct class');
  classes.forEach((c) => assert.match(c, /^stage-color-/));
});

test('the same stage name always yields the same class (repeat calls agree)', () => {
  assert.equal(stageColorClass('coder'), stageColorClass('coder'));
  assert.equal(stageColorClass('QA'), stageColorClass('QA'));
});

test('holder casing does not change the resolved class (badge vs chip may differ in case)', () => {
  assert.equal(stageColorClass('QA'), stageColorClass('qa'));
  assert.equal(stageColorClass('Coder'), stageColorClass('coder'));
});

test('"queued" and missing holder both resolve to the neutral queued class', () => {
  assert.equal(stageColorClass('queued'), 'stage-color-queued');
  assert.equal(stageColorClass(null), 'stage-color-queued');
  assert.equal(stageColorClass(undefined), 'stage-color-queued');
});

test('"done" resolves to a neutral class distinct from queued and every stage', () => {
  const doneClass = stageColorClass('done');
  assert.equal(doneClass, 'stage-color-done');
  assert.notEqual(doneClass, stageColorClass('queued'));
  STAGES.forEach((stage) => assert.notEqual(doneClass, stageColorClass(stage)));
});

test('an unrecognized holder falls back to the neutral queued class, not a crash', () => {
  assert.equal(stageColorClass('some-future-role'), 'stage-color-queued');
});
