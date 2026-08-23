'use strict';

const assert = require('node:assert/strict');
const {
  listScenarios,
  findScenarioCoveringCase,
  missingCoverageCases,
  extractDefinePatternSources,
  expandAlternationFragments,
  orphanedRegistrations,
  hasScenarioNamed,
  knownElapsed,
  knownProcessState,
  COVERAGE_CASES,
} = require('../../specs/pipeline/scripts/bl1099GiveUpCooldownRetirement');

test('knownElapsed and knownProcessState reject unknown labels', () => {
  assert.throws(() => knownElapsed('maybe'), /unrecognized <elapsed>/);
  assert.throws(() => knownProcessState('zombie'), /unrecognized <process state>/);
  assert.equal(knownElapsed('has elapsed'), 'has elapsed');
  assert.equal(knownProcessState('dead'), 'dead');
});

test('expandAlternationFragments expands a single (a|b) group', () => {
  assert.deepEqual(expandAlternationFragments('the cooldown (has elapsed|has not elapsed yet)'), [
    'the cooldown has elapsed',
    'the cooldown has not elapsed yet',
  ]);
  assert.deepEqual(expandAlternationFragments('plain step'), ['plain step']);
});

test('listScenarios names Scenario and Scenario Outline titles', () => {
  const text = `
Feature: x
  Scenario: alpha
    Given a
  Scenario Outline: beta
    Given b
    Examples:
      | x |
      | 1 |
`;
  const names = listScenarios(text).map((s) => s.name);
  assert.deepEqual(names, ['alpha', 'beta']);
});

test('findScenarioCoveringCase finds not-elapsed rows from an Examples table', () => {
  const feature = `
Feature: cooldown
  Scenario Outline: stays down inside cooldown
    Given the give-up cooldown has not yet elapsed
    And the given-up child's recorded process is <process state>
    Then the child is still given up
    And no replacement is spawned
    Examples:
      | process state |
      | dead          |
      | still alive   |
`;
  assert.equal(
    findScenarioCoveringCase([feature], 'has not elapsed', 'dead'),
    'stays down inside cooldown'
  );
  assert.equal(
    findScenarioCoveringCase([feature], 'has not elapsed', 'still alive'),
    'stays down inside cooldown'
  );
});

test('findScenarioCoveringCase treats an elapsed re-arm scenario as covering both process states', () => {
  const feature = `
Feature: cooldown
  Scenario: re-arms after cooldown
    Given the give-up cooldown has elapsed
    Then the child is respawned with a fresh restart budget
`;
  assert.equal(
    findScenarioCoveringCase([feature], 'has elapsed', 'dead'),
    're-arms after cooldown'
  );
  assert.equal(
    findScenarioCoveringCase([feature], 'has elapsed', 'still alive'),
    're-arms after cooldown'
  );
});

test('findScenarioCoveringCase rejects decision-less or mismatched bodies', () => {
  const noDecision = `
Feature: x
  Scenario: mentions cooldown only
    Given the give-up cooldown has not yet elapsed
`;
  assert.equal(findScenarioCoveringCase([noDecision], 'has not elapsed', 'dead'), null);

  const notElapsedOnly = `
Feature: x
  Scenario: not-elapsed without process state
    Given the give-up cooldown has not yet elapsed
    Then the child is still given up
`;
  assert.equal(findScenarioCoveringCase([notElapsedOnly], 'has not elapsed', 'dead'), null);

  const elapsedWithoutRearm = `
Feature: x
  Scenario: elapsed without re-arm wording
    Given the give-up cooldown has elapsed
    Then the child is still given up
`;
  assert.equal(findScenarioCoveringCase([elapsedWithoutRearm], 'has elapsed', 'dead'), null);
});

test('missingCoverageCases reports every uncovered matrix cell', () => {
  const empty = missingCoverageCases(['Feature: none\n']);
  assert.equal(empty.length, COVERAGE_CASES.length);
});

test('extractDefinePatternSources reads registry.define /^...$/ forms', () => {
  const src = `
  registry.define(/^the front-desk supervisor is deciding what to do with a supervised child process$/, () => {});
  registry.define(/^the give-up cooldown (has elapsed|has not elapsed yet)$/, (ctx, elapsed) => {});
`;
  const patterns = extractDefinePatternSources(src);
  assert.equal(patterns.length, 2);
  assert.equal(patterns[1], 'the give-up cooldown (has elapsed|has not elapsed yet)');
});

test('orphanedRegistrations flags a define whose text appears in no feature', () => {
  const handler = `registry.define(/^only this retired step$/ , () => {});`;
  const orphans = orphanedRegistrations(handler, ['Feature: x\n  Scenario: y\n    Given something else\n']);
  assert.deepEqual(orphans, ['only this retired step']);
});

test('orphanedRegistrations is empty when every define is cited', () => {
  const handler = `registry.define(/^a child that has run without crashing past the healthy-uptime window$/, () => {});`;
  const feature = `
Feature: recovery
  Scenario: reset
    Given a child that has run without crashing past the healthy-uptime window
`;
  assert.deepEqual(orphanedRegistrations(handler, [feature]), []);
});

test('hasScenarioNamed detects presence and absence', () => {
  const feature = `
Feature: recovery
  Scenario: a child that stays healthy long enough has its restart count reset
    Given x
`;
  assert.equal(hasScenarioNamed(feature, 'stays healthy long enough'), true);
  assert.equal(hasScenarioNamed(feature, 're-armed only once the cooldown'), false);
});
