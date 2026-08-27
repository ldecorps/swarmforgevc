const assert = require('node:assert/strict');
const {
  parseDependencyCruiserOutput,
  formatBounceNote,
  renderGateOutcome,
  scanTextForStorageGlobal,
  mergeDependencyGateResults,
} = require('../out/quality/dependencyGate');

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

// ── scanTextForStorageGlobal / mergeDependencyGateResults (QA bounce fix) ──
// QA bounce (6747a4812d): dependency-cruiser only sees import/require
// EDGES, so no-webview-storage's wrapper-package-import check
// (idb/localforage/dexie/store2/lockr - none installed, by design) could
// never catch the REALISTIC violation - a bare `localStorage.setItem(...)`
// global reference in media/*.js, which has no import statement at all.
// This supplementary check scans FILE TEXT directly for the literal
// identifiers and reports under the SAME no-webview-storage rule name, so
// the architect's bounce note stays consistent regardless of which
// mechanism actually caught it.

test('scanTextForStorageGlobal flags a bare localStorage reference (QA\'s exact repro pattern)', () => {
  const violation = scanTextForStorageGlobal('media/real-violation.js', "localStorage.setItem('x', '1');\n");
  assert.deepEqual(violation, { from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' });
});

test('scanTextForStorageGlobal flags a bare sessionStorage reference', () => {
  const violation = scanTextForStorageGlobal('media/other.js', 'sessionStorage.getItem("x");\n');
  assert.deepEqual(violation, { from: 'media/other.js', to: 'sessionStorage', rule: 'no-webview-storage' });
});

test('scanTextForStorageGlobal returns null for text mentioning neither identifier', () => {
  assert.equal(scanTextForStorageGlobal('media/clean.js', "console.log('hello');\n"), null);
});

test('scanTextForStorageGlobal does not false-positive on an unrelated identifier that merely CONTAINS the word (word-boundary match)', () => {
  assert.equal(scanTextForStorageGlobal('media/clean.js', 'var myLocalStorageHelper = 1;\n'), null);
});

// Architect bounce (BL-259, 20260710): the naive word-boundary scan above
// matched the file's RAW text, including comments - a `//` or `/* */`
// comment merely discussing localStorage/sessionStorage (e.g. explaining
// why the code avoids it) would itself fail the gate. Strips comments
// before matching, same as any developer reading the file would mentally
// do, so only genuine code usage is flagged.

test('scanTextForStorageGlobal ignores a mention inside a // line comment', () => {
  assert.equal(
    scanTextForStorageGlobal('media/clean.js', "// we intentionally avoid localStorage here\nconsole.log('ok');\n"),
    null
  );
});

test('scanTextForStorageGlobal ignores a mention inside a /* */ block comment', () => {
  assert.equal(
    scanTextForStorageGlobal('media/clean.js', '/* sessionStorage is not available in this webview */\nconsole.log("ok");\n'),
    null
  );
});

test('scanTextForStorageGlobal ignores a mention inside a multi-line /* */ block comment', () => {
  assert.equal(
    scanTextForStorageGlobal('media/clean.js', '/*\n * no localStorage/sessionStorage in this file\n */\nconsole.log("ok");\n'),
    null
  );
});

test('scanTextForStorageGlobal still flags real code usage on the same line as a comment', () => {
  const violation = scanTextForStorageGlobal(
    'media/real-violation.js',
    "localStorage.setItem('x', '1'); // not a comment mention, real usage\n"
  );
  assert.deepEqual(violation, { from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' });
});

test('scanTextForStorageGlobal still flags real code usage elsewhere in a file that also has an unrelated comment mentioning it', () => {
  const violation = scanTextForStorageGlobal(
    'media/real-violation.js',
    '// localStorage is used below intentionally, see ticket BL-XXX\nlocalStorage.setItem("x", "1");\n'
  );
  assert.deepEqual(violation, { from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' });
});

// Architect bounce (BL-259, 20260710, second): the line-comment stripper
// above treated ANY `//` as a comment start, including a `//` inside an
// ordinary string literal (e.g. a URL) - so it silently deleted REAL CODE
// that followed it on the same line, a false NEGATIVE (worse than the
// original false positive: a real violation goes uncaught). Comment
// stripping must be string-aware: a `//`/`/*` inside a '...'/"..."/`...`
// literal is not a comment start.

test('scanTextForStorageGlobal still flags real code after a // inside a URL string literal on the same line', () => {
  const violation = scanTextForStorageGlobal(
    'media/real-violation.js',
    "const url = 'https://example.com'; localStorage.setItem('x', '1');\n"
  );
  assert.deepEqual(violation, { from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' });
});

test('scanTextForStorageGlobal still flags real code after a // inside a double-quoted URL string literal', () => {
  const violation = scanTextForStorageGlobal(
    'media/real-violation.js',
    'fetch("https://example.com/api"); sessionStorage.getItem("x");\n'
  );
  assert.deepEqual(violation, { from: 'media/real-violation.js', to: 'sessionStorage', rule: 'no-webview-storage' });
});

test('scanTextForStorageGlobal still flags real code after a // inside a template-literal URL string', () => {
  const violation = scanTextForStorageGlobal(
    'media/real-violation.js',
    '`https://example.com/${id}`; localStorage.setItem("x", "1");\n'
  );
  assert.deepEqual(violation, { from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' });
});

test('scanTextForStorageGlobal does not treat a /* -looking sequence inside a string as a block-comment start', () => {
  const violation = scanTextForStorageGlobal(
    'media/real-violation.js',
    'const s = "look /* not a comment"; localStorage.setItem("x", "1");\n'
  );
  assert.deepEqual(violation, { from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' });
});

test('scanTextForStorageGlobal still ignores a genuine // comment even when an earlier string on the same line contains a URL', () => {
  assert.equal(
    scanTextForStorageGlobal(
      'media/clean.js',
      "const url = 'https://example.com'; // mentions localStorage only in this comment\nconsole.log(url);\n"
    ),
    null
  );
});

// Hardener bounce evidence (BL-259, 20260710): the hardener's own exact
// repro - a compliant file whose ONLY mention of the forbidden identifiers
// is a two-line explanatory // comment, no real API usage anywhere. Tested
// against commit 648f76d (before the architect's comment-stripping bounce
// landed); already fixed by that same fix, confirmed here as a permanent
// regression test tied to the hardener's own evidence file
// (backlog/evidence/BL-259-gated-dependency-rule-checker-bounce-20260710-hardener.md).
test('scanTextForStorageGlobal passes a compliant file whose only mention is an explanatory comment (hardener repro)', () => {
  const text = [
    '// This view intentionally avoids localStorage/sessionStorage per',
    '// local-engineering.prompt - state lives in the extension host instead.',
    'function noop() { return 1; }',
  ].join('\n');
  assert.equal(scanTextForStorageGlobal('media/compliant.js', text), null);
});

test('mergeDependencyGateResults combines depcruise violations and supplementary-scan violations into one deterministic result', () => {
  const depcruise = { passed: false, violations: [{ from: 'src/a.ts', to: 'fs', rule: 'no-io-from-policy' }] };
  const supplementary = [{ from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' }];
  const merged = mergeDependencyGateResults(depcruise, supplementary);
  assert.equal(merged.passed, false);
  assert.deepEqual(merged.violations, [
    { from: 'media/real-violation.js', to: 'localStorage', rule: 'no-webview-storage' },
    { from: 'src/a.ts', to: 'fs', rule: 'no-io-from-policy' },
  ]);
});

test('mergeDependencyGateResults with a clean depcruise result and no supplementary violations still passes', () => {
  const merged = mergeDependencyGateResults({ passed: true, violations: [] }, []);
  assert.equal(merged.passed, true);
  assert.deepEqual(merged.violations, []);
});

test('mergeDependencyGateResults fails when depcruise is clean but the supplementary scan alone finds a violation', () => {
  const merged = mergeDependencyGateResults(
    { passed: true, violations: [] },
    [{ from: 'media/real-violation.js', to: 'sessionStorage', rule: 'no-webview-storage' }]
  );
  assert.equal(merged.passed, false);
  assert.equal(merged.violations.length, 1);
});
