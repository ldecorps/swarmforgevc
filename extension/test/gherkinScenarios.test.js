const assert = require('node:assert/strict');
const { extractScenarios } = require('../out/docs/gherkinScenarios');

// BL-117 docs-drilldown-03: extractScenarios is pure over already-resolved
// Gherkin text, working identically whether that text came from a
// specs/features/*.feature file or an inline acceptance: | block - both
// forms are just Gherkin syntax by the time this function sees them.

test('extracts a single scenario as readable text', () => {
  const text = [
    'Feature: a thing',
    '',
    'Scenario: it works',
    '  Given a precondition',
    '  When an action happens',
    '  Then an outcome is observed',
    '',
  ].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].name, 'it works');
  assert.match(scenarios[0].text, /Given a precondition/);
  assert.match(scenarios[0].text, /Then an outcome is observed/);
});

test('extracts multiple scenarios independently, each stopping before the next', () => {
  const text = [
    'Feature: a thing',
    '',
    'Scenario: first',
    '  Given a',
    '  Then b',
    '',
    'Scenario: second',
    '  Given c',
    '  Then d',
    '',
  ].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[0].name, 'first');
  assert.doesNotMatch(scenarios[0].text, /Given c/);
  assert.equal(scenarios[1].name, 'second');
  assert.doesNotMatch(scenarios[1].text, /Given a/);
});

test('extracts "Scenario Outline" the same as "Scenario"', () => {
  const text = [
    'Scenario Outline: configurable behavior',
    '  Given <input>',
    '  Then <output>',
    '',
    '  Examples:',
    '    | input | output |',
    '    | 1     | a      |',
    '',
  ].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].name, 'configurable behavior');
  assert.match(scenarios[0].text, /Examples:/);
});

test('ignores Feature/Background text outside any Scenario block', () => {
  const text = ['Feature: a thing', '', 'Background:', '  Given some setup', '', 'Scenario: only this', '  Given x', ''].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios.length, 1);
  assert.doesNotMatch(scenarios[0].text, /Background/);
});

test('ignores comment lines (# BL-NNN tag lines) between scenarios', () => {
  const text = ['# BL-100 cost-01', 'Scenario: tagged', '  Given a', ''].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].name, 'tagged');
});

test('returns an empty array for text with no scenarios at all', () => {
  assert.deepEqual(extractScenarios('Feature: nothing here\n'), []);
});

test('returns an empty array for empty or null input, never throwing', () => {
  assert.deepEqual(extractScenarios(''), []);
  assert.doesNotThrow(() => extractScenarios(null));
  assert.deepEqual(extractScenarios(null), []);
});

test('works identically for a .feature-file-shaped source and an inline acceptance: | block (both forms)', () => {
  const featureFileStyle = 'Feature: x\n\nScenario: shared behavior\n  Given a\n  Then b\n';
  const inlineBlockStyle = 'Feature: x\n\n# BL-149 cooldown-gate-01\nScenario: shared behavior\n  Given a\n  Then b\n';
  const a = extractScenarios(featureFileStyle);
  const b = extractScenarios(inlineBlockStyle);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].name, b[0].name);
});
