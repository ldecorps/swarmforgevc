'use strict';

/**
 * BL-999 invariants (extends BL-969's presence check):
 * 1. Each real-repo budget covers worstMs × MARGIN
 * 2. All real-repo budgets on this path are equal
 * 3. Fixture tests left on the suite default have a recorded margin decision
 *
 * Non-vacuity: dropping a sibling budget below requiredBudgetMs(48926) fails
 * evaluateRealRepoBudgets naming that test (asserted below).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTestTimeouts } = require('../../specs/pipeline/steps/lib/testTimeoutParser');
const {
  MARGIN,
  requiredBudgetMs,
  evaluateRealRepoBudgets,
  evaluateFixtureDecisions,
  REAL_REPO_MEASUREMENTS,
} = require('./renderBriefingBurndownCli.budgets');

const TARGET = path.join(__dirname, 'renderBriefingBurndownCli.test.js');
const FIXTURE_MARKERS = ['writeFixtureSnapshot(', "'--snapshot'"];

function classify() {
  const source = fs.readFileSync(TARGET, 'utf8');
  const calls = parseTestTimeouts(source);
  const anchored = calls.map((c) => ({
    ...c,
    at: source.indexOf(`'${c.name.replace(/'/g, "\\'")}'`),
  }));
  for (const c of anchored) {
    assert.ok(c.at >= 0, `could not anchor test '${c.name}'`);
  }
  anchored.sort((a, b) => a.at - b.at);
  return anchored.map((c, i) => {
    const end = i + 1 < anchored.length ? anchored[i + 1].at : source.length;
    const slice = source.slice(c.at, end);
    const fixture = FIXTURE_MARKERS.some((m) => slice.includes(m));
    return { name: c.name, timeoutMs: c.timeoutMs, fixture };
  });
}

test('BL-999: every real-repo budget covers its recorded worst run × margin, and siblings match', () => {
  const classified = classify();
  assert.equal(classified.filter((c) => !c.fixture).length, 3);
  assert.equal(classified.filter((c) => c.fixture).length, 2);
  const failures = evaluateRealRepoBudgets(classified);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('BL-999: fixture tests on the suite default carry a recorded margin decision', () => {
  const failures = evaluateFixtureDecisions(classify());
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('BL-999 non-vacuity: a present-but-too-small budget fails the relation guard', () => {
  const sibling = Object.keys(REAL_REPO_MEASUREMENTS)[0];
  const need = requiredBudgetMs(REAL_REPO_MEASUREMENTS[sibling].worstMs);
  const names = Object.keys(REAL_REPO_MEASUREMENTS);
  const classified = names.map((name, i) => ({
    name,
    timeoutMs: i === 0 ? 1 : need,
    fixture: false,
  }));
  const failures = evaluateRealRepoBudgets(classified);
  assert.ok(failures.length >= 1, 'expected at least one failure');
  assert.match(failures.join('\n'), new RegExp(sibling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(failures.join('\n'), /budget 1ms/);
  assert.match(failures.join('\n'), new RegExp(String(need)));
  assert.ok(MARGIN >= 1.5);
});
