const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  SIZE_ENVELOPE,
  NO_CLEAN_REASONS,
  ASSERTION_PATTERNS,
  TEST_PATH_PATTERNS,
  DEFAULT_GATE_COMMANDS,
  countChangedLines,
  measureProposal,
  exceedsEnvelope,
  isTestPath,
  assertionLines,
  assertionsWouldChange,
  buildCommitMessage,
  runDeclaredGates,
  boyScoutRun,
  renderRunReport,
  commitEdits,
  PROPOSAL_PATH,
} = require('../out/tools/boyScoutRun');
// BL-1015 D2: main lives at ./boyScoutRun/cli, not re-exported from the
// barrel - see the comment above that export list for why.
const { main } = require('../out/tools/boyScoutRun/cli');

// BL-1015. The acting half of the Boy Scout activity: take the TOP item from
// BL-1014's ranking, clean exactly that one inside a declared envelope, and
// stop. The two failure modes matter more than the happy path - a "cleanup"
// that only reaches green by editing an existing test assertion is a behaviour
// change wearing a refactor's clothes, and a run that quietly does nothing is
// indistinguishable from a run that found nothing.

// ── a harness that records every side effect the run is allowed to have ────

function harness(overrides = {}) {
  const files = new Map(Object.entries(overrides.files || {}));
  const calls = { writes: [], gates: 0, commits: [], gateSawFiles: null };
  const ranked = overrides.ranked || [];
  const env = {
    scanRepository: () => ({ ranked, consulted: [] }),
    propose: overrides.propose || (() => overrides.proposal ?? null),
    readFile: (_root, p) => (files.has(p) ? files.get(p) : null),
    writeFile: (_root, p, content) => {
      calls.writes.push({ path: p, content });
      if (content === null) files.delete(p);
      else files.set(p, content);
    },
    runGates: () => {
      calls.gates += 1;
      calls.gateSawFiles = new Map(files);
      return overrides.gate || { passed: true, ran: ['unit'], failed: [] };
    },
    commit: (_root, message) => {
      calls.commits.push(message);
    },
  };
  return { env, files, calls };
}

function item(subject, sourceCount = 2) {
  return {
    subject,
    sourceCount,
    evidence: [
      { subject, source: 'duplication', artifact: 'jscpd', detail: `${subject} clone` },
      { subject, source: 'crap-over-threshold', artifact: 'crap', detail: `${subject} CRAP` },
    ],
  };
}

function lines(n, prefix = 'l') {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n');
}

// ── the declared envelope ─────────────────────────────────────────────────

test('BL-1015: the envelope is 3 files and 120 lines, derived from BL-634 rather than invented', () => {
  assert.deepEqual(SIZE_ENVELOPE, { files: 3, lines: 120 });
});

test('BL-1015: exceedsEnvelope names every dimension that blew, not just the first', () => {
  assert.deepEqual(exceedsEnvelope({ files: 1, lines: 40 }, SIZE_ENVELOPE), []);
  assert.deepEqual(exceedsEnvelope({ files: 3, lines: 120 }, SIZE_ENVELOPE), [],
    'the limit is inclusive - exactly at the envelope is inside it');
  assert.deepEqual(exceedsEnvelope({ files: 4, lines: 40 }, SIZE_ENVELOPE), ['files']);
  assert.deepEqual(exceedsEnvelope({ files: 1, lines: 400 }, SIZE_ENVELOPE), ['lines']);
  assert.deepEqual(exceedsEnvelope({ files: 9, lines: 900 }, SIZE_ENVELOPE), ['files', 'lines']);
});

// ── counting changed lines ────────────────────────────────────────────────

test('BL-1015: countChangedLines counts additions and removals, not the file size', () => {
  assert.equal(countChangedLines('a\nb\nc', 'a\nb\nc'), 0);
  assert.equal(countChangedLines('a\nb\nc', 'a\nB\nc'), 2, 'one modified line is one removal plus one addition');
  assert.equal(countChangedLines('a\nc', 'a\nb\nc'), 1);
  assert.equal(countChangedLines('a\nb\nc', 'a\nc'), 1);
});

test('BL-1015: a created file counts its whole body, a deleted file counts what it had', () => {
  assert.equal(countChangedLines(null, 'a\nb\nc'), 3);
  assert.equal(countChangedLines('a\nb\nc', null), 3);
  assert.equal(countChangedLines(null, null), 0);
});

test('BL-1015: a small edit deep inside a large file is measured small, not as the whole file', () => {
  // The CRAP-heavy files this run exists to clean are big. Measuring by file
  // size rather than by diff would refuse every one of them on sight, which
  // would make the envelope a ban rather than a bound.
  const big = lines(3000);
  const edited = big.replace('\nl1500\n', '\nCHANGED\n');
  assert.equal(countChangedLines(big, edited), 2);
});

test('BL-1015: a wholesale rewrite of a large file is over the envelope, not silently cheap', () => {
  const changed = countChangedLines(lines(3000, 'a'), lines(3000, 'b'));
  assert.ok(changed > SIZE_ENVELOPE.lines,
    `a 3000-line rewrite must exceed the ${SIZE_ENVELOPE.lines}-line envelope; measured ${changed}`);
});

test('BL-1015: measureProposal counts distinct files, and ignores an edit that changes nothing', () => {
  const current = { 'a.ts': 'x\n', 'b.ts': 'y\n', 'c.ts': 'z\n' };
  const currentOf = (p) => current[p] ?? null;
  const measured = measureProposal(
    [
      { path: 'a.ts', after: 'X\n' },
      { path: 'a.ts', after: 'X\n' },
      { path: 'b.ts', after: 'y\n' },
      { path: 'c.ts', after: 'Z\n' },
    ],
    currentOf
  );
  assert.equal(measured.files, 2, 'b.ts is unchanged, so it is not a changed file; a.ts is named twice but is one file');
  assert.equal(measured.lines, 4);
});

// ── which paths are tests, and what counts as an assertion ────────────────

test('BL-1015: isTestPath recognises every test lane this repository actually has', () => {
  for (const p of [
    'extension/test/boyScoutScan.test.js',
    'extension/test/helpers/tmpDir.js',
    'swarmforge/scripts/test/test_babysitter_check.sh',
    'swarmforge/scripts/test/pre_qa_gate_lib_test_runner.bb',
    'specs/features/BL-1015-a-boy-scout-run.feature',
    'specs/pipeline/steps/bl1014BoyScoutScanRanksDebtSteps.js',
  ]) {
    assert.ok(isTestPath(p), `${p} must be recognised as a test path`);
  }
  for (const p of [
    'extension/src/tools/boyScoutRun.ts',
    'swarmforge/scripts/pre_qa_gate_lib.bb',
    'docs/reference/BL-1014-boy-scout-scan.md',
  ]) {
    assert.ok(!isTestPath(p), `${p} is production code, not a test`);
  }
  assert.ok(TEST_PATH_PATTERNS.length > 0, 'the test-path set is declared, not inferred');
});

test('BL-1015: assertionLines finds assertions in each language this repo tests in', () => {
  const text = [
    "  assert.equal(a, b);",
    "  expect(x).toBe(1);",
    "  (assert-true (= 1 1))",
    "  assert_elements \"a\" \"b\"",
    "  (is (= 1 1))",
    "  const notAnAssertion = 1;",
    "  // assertions are documented here",
  ].join('\n');
  const found = assertionLines(text);
  assert.equal(found.length, 5, `expected five assertion lines, got ${JSON.stringify(found)}`);
  assert.ok(!found.some((l) => l.includes('notAnAssertion')));
  assert.ok(ASSERTION_PATTERNS.length > 0, 'the assertion set is declared, not inferred');
});

test('BL-1015: assertionsWouldChange fires when an existing assertion is removed or reworded', () => {
  const current = { 'extension/test/a.test.js': 'assert.equal(1, 1);\nconst x = 1;\n' };
  const currentOf = (p) => current[p] ?? null;
  assert.ok(
    assertionsWouldChange([{ path: 'extension/test/a.test.js', after: 'const x = 1;\n' }], currentOf),
    'removing the assertion outright must fire'
  );
  assert.ok(
    assertionsWouldChange([{ path: 'extension/test/a.test.js', after: 'assert.equal(1, 2);\nconst x = 1;\n' }], currentOf),
    'changing what the assertion asserts must fire'
  );
  assert.ok(
    assertionsWouldChange([{ path: 'extension/test/a.test.js', after: null }], currentOf),
    'deleting the whole test file removes every assertion in it'
  );
});

test('BL-1015: reformatting around an assertion, and adding a new one, are both allowed', () => {
  const current = { 'extension/test/a.test.js': 'const x = 1;\nassert.equal(1, 1);\n' };
  const currentOf = (p) => current[p] ?? null;
  assert.equal(
    assertionsWouldChange(
      [{ path: 'extension/test/a.test.js', after: 'const renamed = 1;\nassert.equal(1, 1);\nassert.ok(true);\n' }],
      currentOf
    ),
    null,
    'every existing assertion survives verbatim; a new one alongside is not an edit of an existing one'
  );
});

test('BL-1015: two identical assertions are a multiset - dropping one of them still fires', () => {
  // A set-based check would call one surviving copy "still there". It is not:
  // a test that asserted something twice now asserts it once.
  const current = { 'extension/test/a.test.js': 'assert.ok(a);\nassert.ok(a);\n' };
  const currentOf = (p) => current[p] ?? null;
  assert.ok(assertionsWouldChange([{ path: 'extension/test/a.test.js', after: 'assert.ok(a);\n' }], currentOf));
});

test('BL-1015: production code containing the word assert is not guarded as a test', () => {
  const current = { 'extension/src/tools/x.ts': 'assert(ready);\nconst x = 1;\n' };
  const currentOf = (p) => current[p] ?? null;
  assert.equal(
    assertionsWouldChange([{ path: 'extension/src/tools/x.ts', after: 'const x = 1;\n' }], currentOf),
    null,
    'the invariant guards existing TEST assertions - a runtime check in production code is ordinary code'
  );
});

test('BL-1015: a brand-new test file has no existing assertions to preserve', () => {
  assert.equal(
    assertionsWouldChange([{ path: 'extension/test/new.test.js', after: 'assert.ok(1);\n' }], () => null),
    null
  );
});

// ── scenario 01: the top item, and only the top item ──────────────────────

test('BL-1015: the run cleans the top-ranked item and touches no other ranked item', () => {
  const { env, files, calls } = harness({
    ranked: [item('extension/src/a.ts', 3), item('extension/src/b.ts', 2)],
    files: { 'extension/src/a.ts': 'old\n', 'extension/src/b.ts': 'untouched\n' },
    proposal: { subject: 'extension/src/a.ts', summary: 'extract the duplicated block', edits: [{ path: 'extension/src/a.ts', after: 'new\n' }] },
  });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'cleaned');
  assert.equal(result.reason, null);
  assert.equal(result.subject, 'extension/src/a.ts');
  assert.deepEqual(result.editedPaths, ['extension/src/a.ts']);
  assert.equal(files.get('extension/src/b.ts'), 'untouched\n', 'no other ranked item is touched');
  assert.equal(calls.commits.length, 1, 'exactly one commit');
});

test('BL-1015: the run considers exactly one item even when many are ranked', () => {
  const proposed = [];
  const { env } = harness({
    ranked: [item('a.ts', 3), item('b.ts', 2), item('c.ts', 1)],
    files: { 'a.ts': 'old\n' },
    propose: (top) => {
      proposed.push(top.subject);
      return { subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] };
    },
  });
  boyScoutRun('/root', env);
  assert.deepEqual(proposed, ['a.ts'], 'the proposer is asked about the top item once, and never about a second');
});

test('BL-1015: a proposal for something other than the top item is refused whole', () => {
  const { env, calls } = harness({
    ranked: [item('a.ts', 3), item('b.ts', 2)],
    files: { 'b.ts': 'old\n' },
    proposal: { subject: 'b.ts', summary: 's', edits: [{ path: 'b.ts', after: 'new\n' }] },
  });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'refused');
  assert.equal(result.reason, 'wrong-item');
  assert.equal(calls.writes.length, 0, 'nothing is applied');
});

test('BL-1015: a proposal that would edit ANOTHER ranked item is refused whole', () => {
  const { env, calls } = harness({
    ranked: [item('a.ts', 3), item('b.ts', 2)],
    files: { 'a.ts': 'old\n', 'b.ts': 'old\n' },
    proposal: {
      subject: 'a.ts',
      summary: 's',
      edits: [{ path: 'a.ts', after: 'new\n' }, { path: 'b.ts', after: 'new\n' }],
    },
  });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'refused');
  assert.equal(result.reason, 'wrong-item');
  assert.ok(renderRunReport(result).includes('b.ts'), 'the report names the other item it would have touched');
  assert.equal(calls.writes.length, 0);
});

// ── scenario 02: the envelope boundary, both sides of it ──────────────────

function envelopeRun(fileCount, lineCount) {
  // Each file is CREATED by the cleanup, so its changed-line count is exactly
  // its body - the fixture's declared size is the size the run measures.
  const edits = [];
  const per = Math.ceil(lineCount / fileCount);
  let remaining = lineCount;
  for (let i = 0; i < fileCount; i++) {
    const take = Math.min(per, remaining);
    remaining -= take;
    edits.push({ path: `src/f${i}.ts`, after: lines(take) });
  }
  const { env, calls } = harness({
    ranked: [item('src/f0.ts', 3)],
    proposal: { subject: 'src/f0.ts', summary: 'cleanup', edits },
  });
  return { result: boyScoutRun('/root', env), calls };
}

test('BL-1015: 1 file / 40 lines is cleaned', () => {
  const { result } = envelopeRun(1, 40);
  assert.equal(result.outcome, 'cleaned');
});

test('BL-1015: exactly 3 files / 120 lines is cleaned - the limit is inclusive', () => {
  const { result } = envelopeRun(3, 120);
  assert.deepEqual(result.measured, { files: 3, lines: 120 });
  assert.equal(result.outcome, 'cleaned');
});

test('BL-1015: 4 files / 40 lines is refused for files, and nothing is applied', () => {
  const { result, calls } = envelopeRun(4, 40);
  assert.equal(result.outcome, 'refused');
  assert.equal(result.reason, 'envelope-exceeded');
  assert.deepEqual(result.exceeded, ['files']);
  assert.equal(calls.writes.length, 0, 'refused whole - never partially applied');
  assert.equal(calls.gates, 0, 'and the gate set is never spent on a cleanup that was refused on sight');
});

test('BL-1015: 1 file / 400 lines is refused for lines, and nothing is applied', () => {
  const { result, calls } = envelopeRun(1, 400);
  assert.equal(result.outcome, 'refused');
  assert.equal(result.reason, 'envelope-exceeded');
  assert.deepEqual(result.exceeded, ['lines']);
  assert.equal(calls.writes.length, 0);
});

test('BL-1015: the run never widens the envelope to fit an item', () => {
  const { result } = envelopeRun(4, 400);
  assert.deepEqual(result.envelope, SIZE_ENVELOPE);
  assert.equal(result.outcome, 'refused');
});

// ── scenario 03: a refusal is legible ─────────────────────────────────────

test('BL-1015: a refusal report names the item and the envelope it exceeded', () => {
  const { result } = envelopeRun(4, 40);
  const report = renderRunReport(result);
  assert.ok(report.includes('src/f0.ts'), 'the report names the item');
  assert.ok(/\b3\b/.test(report) && /file/.test(report), 'the report names the file limit it blew');
  assert.ok(report.includes('4'), 'and what the cleanup would actually have changed');
  assert.match(report, /REFUSED/);
});

test('BL-1015: a refusal for lines names the line limit, not just "too big"', () => {
  const report = renderRunReport(envelopeRun(1, 400).result);
  assert.ok(report.includes('120'), 'the declared line envelope appears in the report');
  assert.ok(report.includes('400'), 'so does the size that blew it');
});

// ── scenario 04: an assertion edit is abandoned, not forwarded ────────────

test('BL-1015: a cleanup that needs an existing assertion changed is abandoned, and says so', () => {
  const { env, files, calls } = harness({
    ranked: [item('extension/src/a.ts', 3)],
    files: {
      'extension/src/a.ts': 'old\n',
      'extension/test/a.test.js': 'assert.equal(clean(1), 2);\n',
    },
    proposal: {
      subject: 'extension/src/a.ts',
      summary: 'rename clean() to tidy()',
      edits: [
        { path: 'extension/src/a.ts', after: 'new\n' },
        { path: 'extension/test/a.test.js', after: 'assert.equal(tidy(1), 2);\n' },
      ],
    },
  });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'abandoned');
  assert.equal(result.reason, 'assertion-would-change');
  assert.equal(calls.writes.length, 0, 'the test is left untouched - nothing is applied at all');
  assert.equal(files.get('extension/test/a.test.js'), 'assert.equal(clean(1), 2);\n');
  assert.equal(calls.commits.length, 0);
  const report = renderRunReport(result);
  assert.ok(/needs its own ticket/i.test(report), `the report must say the item needs its own ticket; got:\n${report}`);
  assert.ok(report.includes('extension/test/a.test.js'), 'and name the test it would have edited');
});

test('BL-1015: the assertion guard runs BEFORE the envelope is spent, and before any write', () => {
  const { env, calls } = harness({
    ranked: [item('extension/src/a.ts', 3)],
    files: { 'extension/test/a.test.js': 'assert.ok(a);\n' },
    proposal: {
      subject: 'extension/src/a.ts',
      summary: 's',
      edits: [{ path: 'extension/test/a.test.js', after: 'assert.ok(b);\n' }],
    },
  });
  const result = boyScoutRun('/root', env);
  assert.equal(result.reason, 'assertion-would-change');
  assert.equal(calls.gates, 0, 'a cleanup abandoned on the assertion guard never reaches the gate set');
});

// ── scenario 05: a failing gate abandons the cleanup ──────────────────────

test('BL-1015: a failing gate abandons the cleanup, commits nothing, and restores the tree', () => {
  const { env, files, calls } = harness({
    ranked: [item('a.ts', 3)],
    files: { 'a.ts': 'old\n' },
    proposal: { subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] },
    gate: { passed: false, ran: ['unit'], failed: ['unit'] },
  });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'abandoned');
  assert.equal(result.reason, 'gate-failed');
  assert.equal(result.committed, false);
  assert.equal(calls.commits.length, 0, 'no cleanup is committed');
  assert.equal(files.get('a.ts'), 'old\n', 'the working tree is back where it started');
  assert.ok(renderRunReport(result).includes('unit'), 'the report names the gate that failed');
});

test('BL-1015: the gate set sees the CLEANED result, not the original tree', () => {
  const { env, calls } = harness({
    ranked: [item('a.ts', 3)],
    files: { 'a.ts': 'old\n' },
    proposal: { subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] },
  });
  boyScoutRun('/root', env);
  assert.equal(calls.gateSawFiles.get('a.ts'), 'new\n',
    'gates run after the edit is applied - verifying the pre-cleanup tree would prove nothing');
});

test('BL-1015: a gate failure restores a file the cleanup had created, not just one it changed', () => {
  const { env, files } = harness({
    ranked: [item('a.ts', 3)],
    files: { 'a.ts': 'old\n' },
    proposal: {
      subject: 'a.ts',
      summary: 's',
      edits: [{ path: 'a.ts', after: 'new\n' }, { path: 'helper.ts', after: 'extracted\n' }],
    },
    gate: { passed: false, ran: ['unit'], failed: ['unit'] },
  });
  boyScoutRun('/root', env);
  assert.equal(files.has('helper.ts'), false, 'a file the cleanup created is removed again on revert');
  assert.equal(files.get('a.ts'), 'old\n');
});

test('BL-1015: the commit happens only after the gate passed', () => {
  const order = [];
  const { env } = harness({
    ranked: [item('a.ts', 3)],
    files: { 'a.ts': 'old\n' },
    proposal: { subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] },
  });
  const wrapped = {
    ...env,
    runGates: (...args) => {
      order.push('gate');
      return env.runGates(...args);
    },
    commit: (...args) => {
      order.push('commit');
      return env.commit(...args);
    },
  };
  const result = boyScoutRun('/root', wrapped);
  assert.equal(result.committed, true);
  assert.deepEqual(order, ['gate', 'commit']);
});

test('BL-1015: a throw from the gate set restores the tree rather than leaving it half-cleaned', () => {
  const { env, files } = harness({
    ranked: [item('a.ts', 3)],
    files: { 'a.ts': 'old\n' },
    proposal: { subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] },
  });
  const boom = { ...env, runGates: () => { throw new Error('gate runner crashed'); } };
  assert.throws(() => boyScoutRun('/root', boom), /gate runner crashed/);
  assert.equal(files.get('a.ts'), 'old\n', 'never partially applied, even when the run itself fails');
});

// ── scenario 06: never silently empty ─────────────────────────────────────

test('BL-1015: an empty inventory states why nothing was cleaned', () => {
  const { env, calls } = harness({ ranked: [] });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'nothing-to-do');
  assert.equal(result.reason, 'nothing-ranked');
  assert.equal(calls.writes.length, 0);
  assert.match(renderRunReport(result), /nothing-ranked/);
});

test('BL-1015: a top item with no proposal states that, rather than reading as a clean repository', () => {
  const { env } = harness({ ranked: [item('a.ts', 3)], proposal: null });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'nothing-to-do');
  assert.equal(result.reason, 'no-cleanup-proposed');
  const report = renderRunReport(result);
  assert.ok(report.includes('a.ts'), 'the report still names the item it had no cleanup for');
  assert.match(report, /no-cleanup-proposed/);
});

test('BL-1015: a proposal with no edits is not a cleanup', () => {
  const { env } = harness({
    ranked: [item('a.ts', 3)],
    proposal: { subject: 'a.ts', summary: 's', edits: [] },
  });
  assert.equal(boyScoutRun('/root', env).reason, 'no-cleanup-proposed');
});

test('BL-1015: a proposal whose edits change nothing is not a cleanup either', () => {
  // Applying it, running the gates and committing an empty diff would report
  // "cleaned" for a run that changed nothing - the exact ambiguity invariant 3
  // exists to prevent.
  const { env, calls } = harness({
    ranked: [item('a.ts', 3)],
    files: { 'a.ts': 'same\n' },
    proposal: { subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'same\n' }] },
  });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'nothing-to-do');
  assert.equal(result.reason, 'no-cleanup-proposed');
  assert.equal(calls.commits.length, 0);
});

test('BL-1015: every no-clean outcome carries a reason from the declared set', () => {
  assert.ok(NO_CLEAN_REASONS.length >= 4, 'the four reasons invariant 3 names, at minimum');
  for (const required of ['envelope-exceeded', 'gate-failed', 'assertion-would-change', 'nothing-ranked']) {
    assert.ok(NO_CLEAN_REASONS.includes(required), `invariant 3 names ${required} explicitly`);
  }
});

test('BL-1015: a cleaned run carries no reason - only a run that cleaned nothing does', () => {
  const { env } = harness({
    ranked: [item('a.ts', 3)],
    files: { 'a.ts': 'old\n' },
    proposal: { subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] },
  });
  const result = boyScoutRun('/root', env);
  assert.equal(result.reason, null);
  assert.ok(!/REFUSED|ABANDONED/.test(renderRunReport(result)));
});

// ── the report a human reads before accepting the commit ──────────────────

test('BL-1015: a cleaned report names the item, the measured size, and the gates that ran', () => {
  const { env } = harness({
    ranked: [item('extension/src/a.ts', 3)],
    files: { 'extension/src/a.ts': 'old\n' },
    proposal: { subject: 'extension/src/a.ts', summary: 'extract the duplicated block', edits: [{ path: 'extension/src/a.ts', after: 'new\n' }] },
  });
  const report = renderRunReport(boyScoutRun('/root', env));
  assert.ok(report.includes('extension/src/a.ts'));
  assert.ok(report.includes('extract the duplicated block'));
  assert.ok(report.includes('unit'), 'the gates that ran are named, so "verified" is checkable');
  assert.match(report, /CLEANED/);
});

test('BL-1015: the commit message names the ticket, the item and the gates it passed', () => {
  const message = buildCommitMessage({
    subject: 'extension/src/a.ts',
    summary: 'extract the duplicated block',
    measured: { files: 1, lines: 12 },
    envelope: SIZE_ENVELOPE,
    gate: { passed: true, ran: ['unit'], failed: [] },
  });
  assert.ok(message.includes('BL-1015'));
  assert.ok(message.includes('extension/src/a.ts'));
  assert.ok(message.includes('extract the duplicated block'));
  assert.ok(message.includes('unit'));
});

// ── the declared gate set ─────────────────────────────────────────────────

test('BL-1015: the gate set is the repository\'s existing one, declared in one place', () => {
  assert.ok(DEFAULT_GATE_COMMANDS.length > 0);
  for (const g of DEFAULT_GATE_COMMANDS) {
    assert.ok(g.name && g.command, 'every gate is named and runnable');
  }
});

test('BL-1015: runDeclaredGates reports every gate it ran and every one that failed', () => {
  const seen = [];
  const spawn = (cmd, args, cwd) => {
    seen.push({ cmd, args, cwd });
    return { status: cmd === 'fails' ? 1 : 0, output: `${cmd} output` };
  };
  const result = runDeclaredGates(
    '/root',
    [
      { name: 'unit', command: 'passes', args: ['test'], cwd: 'extension' },
      { name: 'lint', command: 'fails', args: [], cwd: '.' },
    ],
    spawn
  );
  assert.deepEqual(result.ran, ['unit', 'lint']);
  assert.deepEqual(result.failed, ['lint']);
  assert.equal(result.passed, false);
  assert.equal(seen[0].cwd, path.join('/root', 'extension'), 'a gate runs where the repository already runs it');
});

test('BL-1015: runDeclaredGates stops at the first failure rather than burning the rest', () => {
  const seen = [];
  const spawn = (cmd) => {
    seen.push(cmd);
    return { status: 1, output: '' };
  };
  const result = runDeclaredGates(
    '/root',
    [
      { name: 'unit', command: 'a', args: [], cwd: '.' },
      { name: 'lint', command: 'b', args: [], cwd: '.' },
    ],
    spawn
  );
  assert.deepEqual(seen, ['a'], 'the cleanup is already abandoned; the second gate would change nothing');
  assert.deepEqual(result.ran, ['unit']);
  assert.deepEqual(result.failed, ['unit']);
});

test('BL-1015: a gate that could not be spawned at all is a failure, never a pass', () => {
  const result = runDeclaredGates('/root', [{ name: 'unit', command: 'x', args: [], cwd: '.' }], () => ({
    status: null,
    error: new Error('ENOENT'),
    output: '',
  }));
  assert.equal(result.passed, false, 'a gate that never ran must not read as a gate that passed');
  assert.deepEqual(result.failed, ['unit']);
});

// ── the default environment reaches BL-1014's scan, and the CLI is thin ───

test('BL-1015: with no scanner injected the run consumes BL-1014\'s scan rather than ranking its own', () => {
  // A second, private ranking would drift from the one the operator was shown.
  // An empty temp root has no debt signals at all, so the real scan ranks
  // nothing - which is only reachable if the real scan is what ran.
  const root = mkTmpDir('bl1015-');
  const result = boyScoutRun(root, { propose: () => null });
  assert.equal(result.outcome, 'nothing-to-do');
  assert.equal(result.reason, 'nothing-ranked');
  assert.equal(result.ranked, 0);
});

test('BL-1015: the default proposer reads the declared proposal file, and matches it to the top item', () => {
  const root = mkTmpDir('bl1015-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'boy-scout'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a.ts'), 'old\n');
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'boy-scout', 'proposal.json'),
    JSON.stringify({ subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] })
  );
  const result = boyScoutRun(root, {
    scanRepository: () => ({ ranked: [item('a.ts', 3)], consulted: [] }),
    runGates: () => ({ passed: true, ran: ['unit'], failed: [] }),
    commit: () => {},
  });
  assert.equal(result.outcome, 'cleaned');
  assert.equal(fs.readFileSync(path.join(root, 'a.ts'), 'utf8'), 'new\n');
});

test('BL-1015: a malformed proposal file is no proposal, not a crash', () => {
  const root = mkTmpDir('bl1015-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'boy-scout'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'boy-scout', 'proposal.json'), '{ not json');
  const result = boyScoutRun(root, { scanRepository: () => ({ ranked: [item('a.ts', 3)], consulted: [] }) });
  assert.equal(result.reason, 'no-cleanup-proposed');
});

test('BL-1015: main is a thin wrapper - it resolves a root, runs, prints, and returns an exit code', () => {
  const root = mkTmpDir('bl1015-');
  const written = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  let code;
  try {
    code = main([root], '/unused-cwd');
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(code, 0, 'a run that cleaned nothing is still a successful run');
  assert.match(written.join(''), /BOY SCOUT RUN/);
});

test('BL-1015: main exits non-zero only when the run could not complete at all', () => {
  // A refusal or an abandonment is a SUCCESSFUL run that reported a reason;
  // only a run that could not produce a result at all is an error exit.
  const written = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  let code;
  try {
    code = main([], '/unused-cwd', {
      scanRepository: () => {
        throw new Error('the scan itself blew up');
      },
    });
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(code, 1);
  assert.match(written.join(''), /the scan itself blew up/, 'and it says what went wrong');
});

test('BL-1015: main resolves a relative root against the cwd it is handed, not process.cwd()', () => {
  const root = mkTmpDir('bl1015-');
  const seen = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    main([path.basename(root)], path.dirname(root), {
      scanRepository: (r) => {
        seen.push(r);
        return { ranked: [], consulted: [] };
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(seen, [root]);
});

// ── the commit stages this run's own paths, and nothing else ──────────────

test('BL-1015: the commit stages only the paths this run edited, never the whole tree', () => {
  // A `git add -A` here would sweep whatever else happened to be dirty in the
  // checkout into a commit whose message claims it cleaned one debt item -
  // the exact shape the house rule against `git add -A` exists to prevent
  // (an approval authorizes only its own ticket's work). Worse, the run's own
  // proposal file lives under .swarmforge/, so `-A` would commit that too.
  //
  // The empty `git ls-files` reply below means "git tracks neither path", so
  // both are ones the cleanup created and both need staging (BL-1015 D1: only
  // untracked paths are staged at all - see the tracked case in the next
  // test).
  const spawned = [];
  commitEdits('/repo', 'BL-1015 boy scout: tidy', ['src/a.ts', 'src/b.ts'], (command, args, cwd) => {
    spawned.push({ command, args, cwd });
    return { status: 0, output: '' };
  });
  assert.deepEqual(spawned.map((s) => s.command), ['git', 'git', 'git']);
  assert.deepEqual(spawned[0].args, ['ls-files', '-z', '--', 'src/a.ts', 'src/b.ts']);
  assert.deepEqual(spawned[1].args, ['add', '--', 'src/a.ts', 'src/b.ts']);
  assert.deepEqual(spawned[2].args, ['commit', '-m', 'BL-1015 boy scout: tidy', '--', 'src/a.ts', 'src/b.ts']);
  for (const call of spawned) {
    assert.equal(call.cwd, '/repo');
    assert.ok(!call.args.includes('-A'), 'never the whole tree');
    assert.ok(!call.args.includes('.'), 'and never a bare pathspec standing in for it');
  }
});

test('BL-1015: a path git already tracks is never staged - the partial commit reaches it on its own', () => {
  // BL-1015 architect send-back #1, D1. `git commit -- <path>` takes its
  // partial commit through a TEMPORARY index, so a tracked path needs no
  // staging - and staging it is precisely what left the real index diverged
  // when the commit then failed.
  const spawned = [];
  commitEdits('/repo', 'BL-1015 boy scout: tidy', ['src/a.ts', 'src/b.ts'], (command, args, cwd) => {
    spawned.push({ command, args, cwd });
    return args[0] === 'ls-files' ? { status: 0, output: 'src/a.ts\0src/b.ts\0' } : { status: 0, output: '' };
  });
  assert.deepEqual(
    spawned.map((s) => s.args[0]),
    ['ls-files', 'commit'],
    'a tracked path was staged anyway'
  );
});

test('BL-1015: a failed commit takes back exactly the staging it did, and nothing else', () => {
  // The undo is scoped to the paths THIS function staged - the ones git did
  // not already track. Unstaging a tracked path would throw away whatever the
  // operator had staged there before the run.
  const spawned = [];
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['src/tracked.ts', 'src/created.ts'], (command, args, cwd) => {
        spawned.push({ command, args, cwd });
        if (args[0] === 'ls-files') return { status: 0, output: 'src/tracked.ts\0' };
        if (args[0] === 'commit') return { status: 1, output: 'pre-commit hook refused' };
        return { status: 0, output: '' };
      }),
    /git commit failed/
  );
  const reset = spawned.filter((s) => s.args[0] === 'reset');
  assert.equal(reset.length, 1, 'a failed commit left its own staging behind');
  assert.deepEqual(reset[0].args, ['reset', '--quiet', '--', 'src/created.ts']);
});

test('BL-1015: an unstage that itself fails is reported alongside the commit failure, never instead of it', () => {
  // The commit failure is the reason the operator needs; a leaked index entry
  // is something they also need to know about. Neither may hide the other.
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['src/created.ts'], (_command, args) => {
        if (args[0] === 'ls-files') return { status: 0, output: '' };
        if (args[0] === 'commit') return { status: 1, output: 'pre-commit hook refused' };
        if (args[0] === 'reset') return { status: 1, output: 'reset refused' };
        return { status: 0, output: '' };
      }),
    /git commit failed.*pre-commit hook refused.*could not unstage src\/created\.ts/s
  );
});

test('BL-1015: a git ls-files that fails falls back to staging everything, and can still take it all back', () => {
  // Unable to tell tracked from created, the safe reading is that every path
  // may need staging - and then every path is this run's own staging to undo.
  const spawned = [];
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['src/a.ts', 'src/b.ts'], (_command, args) => {
        spawned.push(args);
        if (args[0] === 'ls-files') return { status: 1, output: 'not a git repository' };
        if (args[0] === 'commit') return { status: 1, output: 'refused' };
        return { status: 0, output: '' };
      }),
    /git commit failed/
  );
  assert.deepEqual(spawned[1], ['add', '--', 'src/a.ts', 'src/b.ts']);
  assert.deepEqual(spawned[3], ['reset', '--quiet', '--', 'src/a.ts', 'src/b.ts']);
});

test('BL-1015: a commit with no paths is refused rather than becoming a whole-tree commit', () => {
  // An empty pathspec after `--` is not "commit nothing"; it is an argument
  // list git would reject or, worse, a caller reaching for `-A` to recover.
  assert.throws(() => commitEdits('/repo', 'm', [], () => ({ status: 0 })), /no paths/i);
});

test('BL-1015: a failing git add or git commit is an error, not a silent uncommitted success', () => {
  assert.throws(
    () => commitEdits('/repo', 'm', ['a.ts'], () => ({ status: 1, output: 'nothing to add' })),
    /git add failed/
  );
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['a.ts'], (_c, args) =>
        args[0] === 'add' ? { status: 0 } : { status: 1, output: 'pre-commit hook refused' }
      ),
    /git commit failed/
  );
});

test('BL-1015: the run hands its commit exactly the paths it edited', () => {
  const seen = [];
  const { env } = harness({
    files: { 'src/a.ts': 'x\n' },
    ranked: [item('src/a.ts', 3), item('src/z.ts', 1)],
    proposal: {
      subject: 'src/a.ts',
      summary: 'tidy',
      edits: [{ path: 'src/a.ts', after: 'y\n' }, { path: 'src/new.ts', after: 'n\n' }],
    },
  });
  env.commit = (_root, _message, paths) => seen.push(paths);
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'cleaned');
  assert.deepEqual(seen, [['src/a.ts', 'src/new.ts']]);
  assert.deepEqual(seen[0], result.editedPaths, 'the report and the commit describe the same set of files');
});

// ── the default proposer honours the injected reader ──────────────────────

test('BL-1015: the default proposer reads through the injected readFile, not straight off disk', () => {
  // Overriding readFile alone must not leave the proposer reading the real
  // checkout: a caller who injected a fake tree and got the live repository
  // back would be testing nothing, and a run pointed at a fixture root would
  // silently propose against the wrong files.
  const asked = [];
  const result = boyScoutRun('/root', {
    scanRepository: () => ({ ranked: [item('a.ts', 3)], consulted: [] }),
    readFile: (_root, p) => {
      asked.push(p);
      if (p === PROPOSAL_PATH) {
        return JSON.stringify({ subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] });
      }
      return p === 'a.ts' ? 'old\n' : null;
    },
    writeFile: () => {},
    runGates: () => ({ passed: true, ran: ['unit'], failed: [] }),
    commit: () => {},
  });
  assert.ok(asked.includes(PROPOSAL_PATH), 'the proposal was read through the injected seam');
  assert.equal(result.outcome, 'cleaned');
  assert.equal(result.summary, 's');
});
