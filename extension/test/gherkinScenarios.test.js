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

// QA bounce (2026-07-09): a `# BL-XXX tag-NN` comment line BETWEEN two
// scenarios was absorbed into the END of the PRECEDING scenario's text
// (the earlier "ignores comment lines" test above only covered a comment
// BEFORE the first scenario, never between two, which is the actually-
// broken case - reproduces on the large majority of real tickets, since
// almost every multi-scenario feature file in this repo uses this exact
// tag convention between scenarios).
test('a comment tag between two scenarios belongs to neither scenario\'s text (real .feature file shape)', () => {
  const text = [
    'Feature: swarm-name branch namespacing',
    '',
    '# BL-106 branch-ns-01',
    'Scenario: launcher derives branch names from swarm_name',
    '  Given a conf with swarm_name alpha',
    '  When the swarm launches its worktrees',
    '  Then every role worktree is on branch alpha/<role>',
    '',
    '# BL-106 branch-ns-02',
    'Scenario: migration preserves everything',
    '  Given the current mixed-scheme branches',
    '  When the migration runs',
    '  Then each role worktree is on its unified branch with identical HEAD',
    '',
  ].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios.length, 2);
  assert.doesNotMatch(scenarios[0].text, /BL-106 branch-ns-02/, 'the first scenario must not absorb the second scenario\'s own tag');
  assert.match(scenarios[0].text, /alpha\/<role>/, 'the first scenario must still keep its own last real line');
  assert.doesNotMatch(scenarios[1].text, /BL-106 branch-ns-01/);
});

// QA bounce: the LAST scenario in a file additionally absorbed the entire
// trailing "# Non-behavioral gates:" comment block that follows every
// scenario in this repo's own feature files.
test('the last scenario does not absorb a trailing "Non-behavioral gates" comment block', () => {
  const text = [
    'Feature: x',
    '',
    'Scenario: migration preserves everything',
    '  Given the current mixed-scheme branches',
    '  When the migration runs',
    '  Then each role worktree is on its unified branch with identical HEAD',
    '  And stale duplicate role branches are removed only if fully merged',
    '',
    '# Non-behavioral gates:',
    '#  - Derivation/validation logic script-tested; migration rehearsed on',
    '#    a scratch clone before the live run.',
    '#  - No history rewrite; branch renames only.',
  ].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios.length, 1);
  assert.doesNotMatch(scenarios[0].text, /Non-behavioral gates/);
  assert.match(scenarios[0].text, /removed only if fully merged$/, 'text must end at the scenario\'s own last step line');
});

test('a blank line inside a Scenario Outline\'s own Examples table is preserved, not stripped as trailing noise', () => {
  const text = [
    'Scenario Outline: configurable behavior',
    '  Given <input>',
    '  Then <output>',
    '',
    '  Examples:',
    '    | input | output |',
    '    | 1     | a      |',
  ].join('\n');
  const scenarios = extractScenarios(text);
  assert.match(scenarios[0].text, /Examples:/);
  assert.match(scenarios[0].text, /\| 1\s+\| a\s+\|/);
});

// BL-150 recert-01: recertification needs a stable per-scenario id that
// survives reordering - the BL-111 `# <TICKET-ID> <slug>` tag comment
// directly above a Scenario: line.

test('captures the stable id from a `# TICKET-ID slug` tag comment directly above the scenario', () => {
  const text = ['# BL-096 metrics-01', 'Scenario: velocity series matches git-recorded closes', '  Given a', '  Then b', ''].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios[0].id, 'BL-096/metrics-01');
});

test('captures only the ticket-id and slug when the tag comment has trailing descriptive words', () => {
  const text = ['  # BL-150 recert-01 oldest-first-selection', 'Scenario: the human is shown the least-recently-reviewed scenario first', '  Given a', ''].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios[0].id, 'BL-150/recert-01');
});

test('a scenario with no tag comment above it has no id (pre-BL-111 inline acceptance blocks)', () => {
  const text = ['Scenario: untagged', '  Given a', ''].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios[0].id, undefined);
});

test('each scenario gets only its OWN directly-preceding tag, never a neighbor\'s', () => {
  const text = [
    '# BL-106 branch-ns-01',
    'Scenario: first',
    '  Given a',
    '',
    '# BL-106 branch-ns-02',
    'Scenario: second',
    '  Given b',
    '',
  ].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios[0].id, 'BL-106/branch-ns-01');
  assert.equal(scenarios[1].id, 'BL-106/branch-ns-02');
});

test('a trailing "Non-behavioral gates" comment block after the last scenario is never mistaken for a tag', () => {
  const text = [
    'Scenario: migration preserves everything',
    '  Given a',
    '',
    '# Non-behavioral gates:',
    '#  - some gate',
  ].join('\n');
  const scenarios = extractScenarios(text);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].id, undefined);
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
