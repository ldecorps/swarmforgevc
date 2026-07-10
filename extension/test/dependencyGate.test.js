const assert = require('node:assert/strict');
const { parseDependencyCruiserOutput, formatBounceNote, renderGateOutcome } = require('../out/quality/dependencyGate');

// BL-259: the gate wrapper - parses RECORDED dependency-cruiser JSON output
// (the shape real depcruise --output-type json produces) into a pass/
// violations decision, and formats the architect's bounce note. No live
// depcruise run in these tests (the pinned tool + real ruleset is
// separately validated by dependencyGateCli.test.js's fixture-based
// subprocess tests, per the ticket's own TESTABLE-boundary split).

function depcruiseOutput(violations) {
  return JSON.stringify({ summary: { violations, error: violations.filter((v) => v.rule.severity === 'error').length } });
}

function violation(from, to, ruleName, severity = 'error') {
  return { type: 'dependency', from, to, rule: { severity, name: ruleName } };
}

// ── clean-passes-01 ────────────────────────────────────────────────────

test('no violations in the recorded output -> the gate passes', () => {
  const result = parseDependencyCruiserOutput(depcruiseOutput([]));
  assert.equal(result.passed, true);
  assert.deepEqual(result.violations, []);
});

// ── violation-hard-fails-and-bounces-02 ──────────────────────────────────

test('a recorded violation -> the gate fails, naming the offending edge and rule', () => {
  const result = parseDependencyCruiserOutput(
    depcruiseOutput([violation('src/quality/bad.ts', 'fs', 'no-io-from-policy')])
  );
  assert.equal(result.passed, false);
  assert.deepEqual(result.violations, [{ from: 'src/quality/bad.ts', to: 'fs', rule: 'no-io-from-policy' }]);
});

test('formatBounceNote names the offending edge (source -> target) and the rule it breaks', () => {
  const note = formatBounceNote([{ from: 'src/quality/bad.ts', to: 'fs', rule: 'no-io-from-policy' }]);
  assert.match(note, /src\/quality\/bad\.ts/);
  assert.match(note, /fs/);
  assert.match(note, /no-io-from-policy/);
});

test('a warn-severity entry (not error) never fails the gate - only error severity is a hard fail', () => {
  const result = parseDependencyCruiserOutput(
    depcruiseOutput([violation('src/a.ts', 'src/b.ts', 'some-warn-rule', 'warn')])
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.violations, []);
});

// ── ruleset-enforced-03: every rule name passes through untouched ────────

for (const ruleName of [
  'no-io-from-policy',
  'view-not-import-host-io',
  'no-process-spawn-from-view',
  'core-not-vscode-api',
  'no-webview-storage',
  'acyclic',
]) {
  test(`a violation of "${ruleName}" is reported under that exact rule name`, () => {
    const result = parseDependencyCruiserOutput(depcruiseOutput([violation('src/a.ts', 'src/b.ts', ruleName)]));
    assert.equal(result.violations[0].rule, ruleName);
  });
}

// ── deterministic-report-04 ────────────────────────────────────────────

test('violations are sorted deterministically (from, then to, then rule) regardless of input order', () => {
  const result = parseDependencyCruiserOutput(
    depcruiseOutput([
      violation('src/z.ts', 'src/a.ts', 'rule-z'),
      violation('src/a.ts', 'src/z.ts', 'rule-a'),
      violation('src/a.ts', 'src/a.ts', 'rule-b'),
    ])
  );
  assert.deepEqual(
    result.violations.map((v) => `${v.from}->${v.to}:${v.rule}`),
    ['src/a.ts->src/a.ts:rule-b', 'src/a.ts->src/z.ts:rule-a', 'src/z.ts->src/a.ts:rule-z']
  );
});

test('parsing the same recorded output twice produces byte-identical results', () => {
  const raw = depcruiseOutput([violation('src/b.ts', 'src/a.ts', 'rule-1'), violation('src/a.ts', 'src/b.ts', 'rule-2')]);
  const first = parseDependencyCruiserOutput(raw);
  const second = parseDependencyCruiserOutput(raw);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('formatBounceNote is byte-identical across repeated calls on the same violations', () => {
  const violations = [{ from: 'src/a.ts', to: 'src/b.ts', rule: 'acyclic' }];
  assert.equal(formatBounceNote(violations), formatBounceNote(violations));
});

// ── malformed/empty input never crashes ───────────────────────────────

test('output with no summary.violations key at all reads as passed, never a crash', () => {
  const result = parseDependencyCruiserOutput(JSON.stringify({ summary: {} }));
  assert.equal(result.passed, true);
  assert.deepEqual(result.violations, []);
});

test('formatBounceNote on an empty violations array (never called for a passing gate, but must not throw)', () => {
  assert.doesNotThrow(() => formatBounceNote([]));
});

// ── renderGateOutcome (pure) ────────────────────────────────────────────
// Hardener split: dependency-gate.ts's main() can only ever be exercised
// end-to-end against the REAL repo (its runDependencyCruiser hardcodes
// cwd=EXTENSION_ROOT, so a subprocess test pointed at an isolated fixture
// can never reach main()'s fail branch) - this pure function carries the
// pass/fail -> printed-text/exit-code decision so BOTH branches are
// directly testable here, in-process, with no subprocess involved.

test('renderGateOutcome for a passing result: PASSED text, exit code 0', () => {
  const outcome = renderGateOutcome({ passed: true, violations: [] });
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.text, /PASSED: no forbidden edges/);
});

test('renderGateOutcome for a failing result: the bounce note text, exit code 1', () => {
  const violations = [{ from: 'src/quality/bad.ts', to: 'fs', rule: 'no-io-from-policy' }];
  const outcome = renderGateOutcome({ passed: false, violations });
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.text, formatBounceNote(violations));
});
