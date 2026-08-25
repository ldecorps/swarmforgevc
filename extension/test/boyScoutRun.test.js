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
  defaultGateSpawn,
  boyScoutRun,
  renderRunReport,
  commitEdits,
  PROPOSAL_PATH,
  readProposalFile,
  defaultEnvironment,
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

test('BL-1015: PROPOSAL_PATH is exactly .swarmforge/boy-scout/proposal.json, not merely "wherever the constant points"', () => {
  // A test that only ever compares PROPOSAL_PATH against itself (e.g. "the
  // seam read from PROPOSAL_PATH") can never catch a mutation to one of its
  // OWN path segments - the mutated build would still read from "wherever
  // PROPOSAL_PATH points now" and pass. Pin the literal segments here,
  // independently of the constant under test.
  assert.equal(PROPOSAL_PATH, path.join('.swarmforge', 'boy-scout', 'proposal.json'));
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

test('BL-1015: prefix trimming stops at the SHORTER side\'s bound, not just the longer side\'s', () => {
  // The prefix-trim guard is a genuine AND of both lengths - if either half
  // were replaced by an always-true condition, `start` would keep advancing
  // past the shorter array's real length, corrupting the interior diff.
  assert.equal(countChangedLines('x\nx\nx', 'x'), 2, 'b is exhausted after one shared line; a keeps its other two as changes');
});

test('BL-1015: suffix trimming stops at the SHORTER side\'s bound too', () => {
  assert.equal(countChangedLines('p\nx\nx\nx', 'q\nx'), 4, 'no common prefix at all, so the whole of both sides differ');
});

test('BL-1015: suffix trimming must not walk PAST the prefix boundary, even when content repeats', () => {
  // `a` is entirely consumed as the common prefix (start === a.length), so
  // there is nothing left of `a` for the suffix scan to legitimately trim.
  // `b`'s LAST line happens to equal that same prefix line ('SAME') by
  // coincidence - a suffix guard that forgot to stop at `start` would keep
  // matching backward past the boundary anyway, treating the prefix's own
  // 'SAME' as if it were more shared suffix, and silently swallow one line
  // of `b`'s real addition ('Q').
  assert.equal(countChangedLines('SAME', 'SAME\nQ\nSAME'), 2,
    'both "Q" and the second "SAME" are additions; the guard must stop suffix trimming exactly at the prefix boundary');
});

test('BL-1015: a common prefix AND a common suffix each big enough alone to force the LCS cap, if either trim is skipped', () => {
  // Disabling EITHER trim independently (leaving the untrimmed side's full
  // bulk in the "differing middle") must still cross LCS_CELL_CAP on its
  // own - proving neither trim is optional for staying both cheap AND
  // correct on a file this large, not just as a joint optimization.
  const N = 2200;
  const prefix = Array.from({ length: N }, (_, i) => `PRE_${i}`);
  const suffix = Array.from({ length: N }, (_, i) => `SUF_${i}`);
  const before = [...prefix, 'MID_A1', 'MID_A2', ...suffix].join('\n');
  const after = [...prefix, 'MID_B1', 'MID_B2', ...suffix].join('\n');
  assert.equal(countChangedLines(before, after), 4,
    'only the 2-line middle differs; skipping either trim would report thousands of lines changed instead');
});

test('BL-1015: the interior LCS genuinely walks the whole DP table, not just the trimmed edges', () => {
  // Prefix/suffix trim strip 'p' and 'q'; the interior ['A','B','C'] vs
  // ['B','A','D'] cannot be resolved by trimming alone - it needs the real
  // recurrence (a[i-1] vs a[i], the ternary's match branch, Math.max, not
  // Math.min) to find the true best common subsequence (length 1: at most
  // one of A or B, never both, since their order is swapped).
  assert.equal(countChangedLines('p\nA\nB\nC\nq', 'p\nB\nA\nD\nq'), 4);
});

test('BL-1015: the LCS recurrence walks EVERY row of `a`, including the last one', () => {
  // An off-by-one outer bound (`i < a.length` instead of `i <= a.length`)
  // would silently drop `a`'s LAST line from the DP table. That only shows
  // up when the dropped line is the one that matches something in `b` -
  // 'm' here matches at a DIFFERENT position in `b`, so skipping it changes
  // the best common subsequence found, not just which row computed it.
  assert.equal(countChangedLines('PRE\np\nm\nSUF', 'PRE\nm\nq\nSUF'), 2,
    'the trailing "m" is common (length-1 LCS via a mid-array match), not just the endpoints');
});

test('BL-1015: the LCS cell cap is a strict >, not >=  - EXACTLY at the cap still runs the real (cheaper, correct) LCS', () => {
  // 2000x2000 = 4,000,000 = LCS_CELL_CAP exactly. A >= mutant here would
  // wrongly take the cap shortcut (which ignores real sharing) at the exact
  // boundary the real algorithm is still meant to handle.
  const mid = Array.from({ length: 1998 }, (_, i) => `SHARED_${i}`);
  const a = ['A_START', ...mid, 'A_END'].join('\n');
  const b = ['B_START', ...mid, 'B_END'].join('\n');
  assert.equal(countChangedLines(a, b), 4, 'only the two distinct endpoints differ; the shared middle must be recognised');
});

test('BL-1015: one cell OVER the cap takes the declared upper-bound shortcut, not the real (lower, sharing-aware) count', () => {
  const mid = Array.from({ length: 1999 }, (_, i) => `SHARED_${i}`);
  const a = ['A_START', ...mid, 'A_END'].join('\n');
  const b = ['B_START', ...mid, 'B_END'].join('\n');
  // 2001 x 2001 = 4,004,001 > LCS_CELL_CAP: the shortcut ra.length+rb.length
  // is used, which - unlike the real LCS - does NOT credit the shared
  // middle, so it reports a much larger (wrong-if-you-forgot-the-cap-exists,
  // but declared and intentional) count.
  assert.equal(countChangedLines(a, b), 4002, 'the declared upper bound, not the true (much smaller) shared-aware count');
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

// ── readProposalFile: reading, validating, and filtering a written proposal ─

test('BL-1015: readProposalFile returns null, not a crash, when there is no file at all', () => {
  assert.equal(readProposalFile('/root', () => null), null);
});

test('BL-1015: readProposalFile returns null on unparseable JSON', () => {
  assert.equal(readProposalFile('/root', () => '{ not json'), null);
});

test('BL-1015: readProposalFile rejects a non-object candidate even with no subject/edits check reached', () => {
  // Valid JSON, but not a candidate object at all (null, a bare number) -
  // isolates the `!candidate` arm of the OR from the other two.
  assert.equal(readProposalFile('/root', () => 'null'), null);
  assert.equal(readProposalFile('/root', () => '42'), null);
});

test('BL-1015: readProposalFile rejects a missing/non-string subject even when edits is a valid array', () => {
  assert.equal(readProposalFile('/root', () => JSON.stringify({ edits: [] })), null, 'no subject at all');
  assert.equal(readProposalFile('/root', () => JSON.stringify({ subject: 3, edits: [] })), null, 'subject is not a string');
});

test('BL-1015: readProposalFile rejects a missing/non-array edits even when subject is a valid string', () => {
  assert.equal(readProposalFile('/root', () => JSON.stringify({ subject: 'a.ts' })), null, 'no edits at all');
  assert.equal(
    readProposalFile('/root', () => JSON.stringify({ subject: 'a.ts', edits: 'not-an-array' })),
    null,
    'edits is not an array'
  );
});

test('BL-1015: readProposalFile filters out every malformed edit, keeping only well-shaped ones', () => {
  const result = readProposalFile(
    '/root',
    () =>
      JSON.stringify({
        subject: 'a.ts',
        edits: [
          { path: 'a.ts', after: 'new\n' }, // valid: after is a string
          { path: 'b.ts', after: null }, // valid: after is null (deletion)
          null, // falsy edit, dropped
          { path: 42, after: 'x' }, // non-string path, dropped
          { path: 'c.ts', after: 7 }, // after is neither string nor null, dropped
        ],
      })
  );
  assert.deepEqual(result.edits, [
    { path: 'a.ts', after: 'new\n' },
    { path: 'b.ts', after: null },
  ]);
});

test('BL-1015: readProposalFile falls back to the subject as the summary when none is given', () => {
  const result = readProposalFile('/root', () => JSON.stringify({ subject: 'a.ts', edits: [] }));
  assert.equal(result.summary, 'a.ts');
});

// ── the default environment's real-disk IO ─────────────────────────────────

test('BL-1015: defaultEnvironment.writeFile(root, path, null) deletes a file, and tolerates one that never existed', () => {
  const root = mkTmpDir('bl1015-');
  fs.writeFileSync(path.join(root, 'present.txt'), 'x');
  defaultEnvironment.writeFile(root, 'present.txt', null);
  assert.ok(!fs.existsSync(path.join(root, 'present.txt')));
  // force: true is load-bearing here - without it, deleting a path that was
  // never created (a NEW file this run added and is now rolling back) throws
  // ENOENT instead of being a no-op.
  assert.doesNotThrow(() => defaultEnvironment.writeFile(root, 'never-existed.txt', null));
});

test('BL-1015: defaultEnvironment.runGates actually runs the real declared gates, not a stub returning undefined', () => {
  const root = mkTmpDir('bl1015-');
  const result = defaultEnvironment.runGates(root);
  assert.equal(typeof result, 'object');
  assert.ok(Array.isArray(result.ran), 'a real GateResult names which gates it ran');
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

test('BL-1015: isTestPath regex boundaries - anchors and negated classes actually bound the match', () => {
  // (^|\/)tests?\/ - the anchor must require a path SEGMENT boundary, not any substring.
  assert.ok(!isTestPath('xtests/foo.js'), '"xtests/" must not be mistaken for a "tests/" segment');
  assert.ok(isTestPath('src/tests/foo.ts'), 'tests/ preceded by a slash still matches');
  // test_[^/]*\.(sh|bb)$ - [^/] must stop the match at a directory separator.
  assert.ok(!isTestPath('swarmforge/scripts/test_dir/thing.sh'), 'a slash inside the middle segment must not be swallowed by [^/]*');
  assert.ok(isTestPath('swarmforge/scripts/test_babysitter.sh'), 'no slash after test_ still matches');
  // _test(_runner)?\.bb$ - the trailing $ must reject a longer suffix.
  assert.ok(!isTestPath('swarmforge/scripts/foo_test.bb.orig'), 'a suffix after .bb must not match the $-anchored pattern');
  assert.ok(!isTestPath('swarmforge/scripts/foo_test_other.bb'), '"_test_other" is not the declared "_test" or "_test_runner" shape');
  // _property_runner\.bb$ - same anchor requirement.
  assert.ok(!isTestPath('swarmforge/scripts/foo_property_runner.bb.bak'), 'a suffix after .bb must not match');
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

test('BL-1015: assertionLines regex boundaries - whitespace quantifiers and anchors actually bound the match', () => {
  // ^\s*assert[-_\w]*\s+\S - \s+ requires at least the ONE separating space,
  // and a leading run of whitespace before "assert" must still be allowed.
  assert.equal(assertionLines('  assert_elements  "a" "b"').length, 1, 'multiple spaces before the argument still matches \\s+');
  assert.equal(assertionLines('assert_elements"a"').length, 0, 'no separating space at all must not match \\s+\\S');
  // \bexpect\s*\( - \s* must accept whitespace between "expect" and "(".
  assert.equal(assertionLines('expect (x).toBe(1);').length, 1, 'a space before the paren is still \\s* zero-or-more whitespace');
  // \(\s*is\s+ - both \s* (before "is") and \s+ (after "is") must accept real whitespace.
  assert.equal(assertionLines('( is  (= 1 1))').length, 1, 'whitespace after "(" and two spaces after "is" both still match');
});

test('BL-1015: assertionLines trims each line before comparison, so re-indenting is not mistaken for a change', () => {
  // Without trim(), a line's leading whitespace becomes part of the stored
  // string, so a purely cosmetic re-indent (moving an assertion one level
  // deeper) would look like the old assertion vanished and a DIFFERENT one
  // appeared - a false positive against invariant 2, not a missed one, but a
  // real behavioural difference this function exists to avoid.
  assert.deepEqual(assertionLines('assert.ok(a);'), assertionLines('    assert.ok(a);'));
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
  // The subject-mismatch refusal and the trespass refusal share the same
  // {outcome, reason} shape - only `detail` distinguishes which check fired,
  // so it must name both the wrong subject and the top-ranked one.
  assert.ok(result.detail.includes('b.ts') && result.detail.includes('a.ts') && result.detail.includes('not the top-ranked'));
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

test('BL-1015: trespass onto MULTIPLE other ranked items are all named, joined by comma-space', () => {
  const { env } = harness({
    ranked: [item('a.ts', 3), item('b.ts', 2), item('c.ts', 1)],
    files: { 'a.ts': 'old\n', 'b.ts': 'old\n', 'c.ts': 'old\n' },
    proposal: {
      subject: 'a.ts',
      summary: 's',
      edits: [{ path: 'a.ts', after: 'new\n' }, { path: 'b.ts', after: 'new\n' }, { path: 'c.ts', after: 'new\n' }],
    },
  });
  const result = boyScoutRun('/root', env);
  assert.ok(result.detail.includes('b.ts, c.ts'), `expected a comma-space joined list, got: ${result.detail}`);
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

test('BL-1015: a throw from the commit itself restores the tree rather than leaving the edit applied uncommitted', () => {
  const { env, files } = harness({
    ranked: [item('a.ts', 3)],
    files: { 'a.ts': 'old\n' },
    proposal: { subject: 'a.ts', summary: 's', edits: [{ path: 'a.ts', after: 'new\n' }] },
  });
  const boom = { ...env, commit: () => { throw new Error('git commit crashed'); } };
  assert.throws(() => boyScoutRun('/root', boom), /git commit crashed/);
  assert.equal(files.get('a.ts'), 'old\n', 'a commit that throws must not leave the gated edit sitting uncommitted on disk');
});

// ── scenario 06: never silently empty ─────────────────────────────────────

test('BL-1015: an empty inventory states why nothing was cleaned', () => {
  const { env, calls } = harness({ ranked: [] });
  const result = boyScoutRun('/root', env);
  assert.equal(result.outcome, 'nothing-to-do');
  assert.equal(result.reason, 'nothing-ranked');
  assert.equal(calls.writes.length, 0);
  assert.match(renderRunReport(result), /nothing-ranked/);
  // The blank-result shape itself, not just the reason - an unfilled `measured`
  // or a planted placeholder in `exceeded`/`editedPaths` would still read as
  // "nothing-ranked" but would be lying about there being no measurement or
  // no edited paths yet.
  assert.deepEqual(result.measured, { files: 0, lines: 0 });
  assert.deepEqual(result.exceeded, []);
  assert.deepEqual(result.editedPaths, []);
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
  const result = boyScoutRun('/root', env);
  assert.equal(result.reason, 'no-cleanup-proposed');
  // Isolates this early "no edits at all" refusal from the LATER
  // "measured.files === 0" refusal a few checks downstream - both report the
  // same reason, but only the later one sets a detail string.
  assert.equal(result.detail, null, 'the early empty-edits refusal carries no detail of its own');
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
  assert.equal(result.detail, 'the proposal changes nothing');
});

test('BL-1015: every no-clean outcome carries a reason from the declared set', () => {
  assert.ok(NO_CLEAN_REASONS.length >= 4, 'the four reasons invariant 3 names, at minimum');
  // All SIX declared values, not just the four the ticket names verbatim -
  // 'no-cleanup-proposed' and 'wrong-item' are real states this run reports
  // and must not silently collapse to an empty string.
  for (const required of [
    'envelope-exceeded',
    'gate-failed',
    'assertion-would-change',
    'nothing-ranked',
    'no-cleanup-proposed',
    'wrong-item',
  ]) {
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
    envelope: { files: 3, lines: 120 },
    gate: { passed: true, ran: ['unit', 'lint'], failed: [] },
  });
  // Exact line-by-line shape, not loose substrings - so an emptied template
  // literal, a dropped join separator, or a stray blank-line swap all fail.
  assert.deepEqual(message.split('\n'), [
    'BL-1015 boy scout: extract the duplicated block',
    '',
    'Cleaned the top-ranked debt item from the Boy Scout scan: extension/src/a.ts.',
    'Envelope: 1 file(s), 12 line(s) of 3/120.',
    'Gates passed before commit: unit, lint.',
  ]);
});

test('BL-1015: the commit message names "none" for the gates when no gate result is available', () => {
  // The optional chaining on result.gate?.ran matters precisely when gate is
  // null/undefined - a caller that never ran a gate (or a report rendered
  // before gating) must not crash reading .ran off null.
  const message = buildCommitMessage({
    subject: 'a.ts',
    summary: 's',
    measured: { files: 1, lines: 1 },
    envelope: SIZE_ENVELOPE,
    gate: null,
  });
  assert.ok(message.includes('Gates passed before commit: none.'));
});

// ── renderRunReport: the exact text a human reads before accepting a commit ─
//
// Every branch here asserts the FULL report string, not a loose substring -
// an emptied template literal, a swapped ternary branch, a dropped join
// separator, or a mis-cased switch label all produce a visibly different
// exact string, which a `.includes()` check would happily let through.

test('BL-1015 report: a CLEANED run, full exact text', () => {
  const result = {
    outcome: 'cleaned', reason: null, subject: 'a.ts', summary: 'tidy up',
    measured: { files: 1, lines: 5 }, envelope: { files: 3, lines: 120 },
    exceeded: [], editedPaths: ['a.ts', 'b.ts'], committed: true,
    gate: { passed: true, ran: ['unit', 'lint'], failed: [] }, ranked: 2, detail: null,
  };
  assert.equal(
    renderRunReport(result),
    [
      'BOY SCOUT RUN — one item, cleaned or refused whole',
      '',
      'items ranked: 2',
      'top-ranked item: a.ts',
      'proposed cleanup: tidy up',
      '',
      'outcome: CLEANED — a.ts',
      '  changed 1 file(s), 5 line(s) within an envelope of 3 file(s), 120 line(s)',
      '  gates passed before commit: unit, lint',
      '  files: a.ts, b.ts',
      '  committed: yes',
      '',
    ].join('\n')
  );
});

test('BL-1015 report: a CLEANED run that was not committed, and had no proposed-cleanup summary', () => {
  const result = {
    outcome: 'cleaned', reason: null, subject: 'a.ts', summary: null,
    measured: { files: 1, lines: 5 }, envelope: { files: 3, lines: 120 },
    exceeded: [], editedPaths: ['a.ts'], committed: false,
    gate: null, ranked: 1, detail: null,
  };
  assert.equal(
    renderRunReport(result),
    [
      'BOY SCOUT RUN — one item, cleaned or refused whole',
      '',
      'items ranked: 1',
      'top-ranked item: a.ts',
      '',
      'outcome: CLEANED — a.ts',
      '  changed 1 file(s), 5 line(s) within an envelope of 3 file(s), 120 line(s)',
      '  gates passed before commit: none',
      '  files: a.ts',
      '  committed: no',
      '',
    ].join('\n')
  );
});

test('BL-1015 report: no top item at all - "(none)" and no proposed-cleanup line', () => {
  const result = {
    outcome: 'nothing-to-do', reason: 'nothing-ranked', subject: null, summary: null,
    measured: { files: 0, lines: 0 }, envelope: { files: 3, lines: 120 },
    exceeded: [], editedPaths: [], committed: false, gate: null, ranked: 0, detail: null,
  };
  assert.equal(
    renderRunReport(result),
    [
      'BOY SCOUT RUN — one item, cleaned or refused whole',
      '',
      'items ranked: 0',
      'top-ranked item: (none)',
      '',
      'outcome: NOTHING CLEANED — nothing-ranked',
      '  the scan ranked no debt at all, so there was no top item to clean.',
      '  nothing was committed; the working tree is unchanged.',
      '',
    ].join('\n')
  );
});

test('BL-1015 report: REFUSED for wrong-item names the detail, and the envelope line is absent (nothing exceeded)', () => {
  const result = {
    outcome: 'refused', reason: 'wrong-item', subject: 'b.ts', summary: 's',
    measured: { files: 0, lines: 0 }, envelope: { files: 3, lines: 120 },
    exceeded: [], editedPaths: ['b.ts'], committed: false, gate: null, ranked: 2,
    detail: 'the proposal is for b.ts, not the top-ranked a.ts',
  };
  assert.equal(
    renderRunReport(result),
    [
      'BOY SCOUT RUN — one item, cleaned or refused whole',
      '',
      'items ranked: 2',
      'top-ranked item: b.ts',
      'proposed cleanup: s',
      '',
      'outcome: REFUSED — wrong-item',
      '  the proposal is for b.ts, not the top-ranked a.ts; a run cleans the top-ranked item or nothing.',
      '  nothing was committed; the working tree is unchanged.',
      '',
    ].join('\n')
  );
});

test('BL-1015 report: REFUSED for envelope-exceeded names BOTH exceeded axes, joined by " and "', () => {
  const result = {
    outcome: 'refused', reason: 'envelope-exceeded', subject: 'a.ts', summary: 's',
    measured: { files: 5, lines: 400 }, envelope: { files: 3, lines: 120 },
    exceeded: ['files', 'lines'], editedPaths: [], committed: false, gate: null, ranked: 1,
    detail: 'the cleanup would change 5 file(s) and 400 line(s)',
  };
  assert.equal(
    renderRunReport(result),
    [
      'BOY SCOUT RUN — one item, cleaned or refused whole',
      '',
      'items ranked: 1',
      'top-ranked item: a.ts',
      'proposed cleanup: s',
      '',
      'outcome: REFUSED — envelope-exceeded',
      '  the cleanup would change 5 file(s) and 400 line(s), which is bigger than one sitting.',
      '  the envelope is 3 file(s) and 120 line(s); exceeded: files and lines',
      '  nothing was committed; the working tree is unchanged.',
      '',
    ].join('\n')
  );
});

test('BL-1015 report: ABANDONED for assertion-would-change names the offending test file', () => {
  const result = {
    outcome: 'abandoned', reason: 'assertion-would-change', subject: 'a.ts', summary: 's',
    measured: { files: 2, lines: 10 }, envelope: { files: 3, lines: 120 },
    exceeded: [], editedPaths: ['a.ts', 'a.test.js'], committed: false, gate: null, ranked: 1,
    detail: 'a.test.js',
  };
  assert.equal(
    renderRunReport(result),
    [
      'BOY SCOUT RUN — one item, cleaned or refused whole',
      '',
      'items ranked: 1',
      'top-ranked item: a.ts',
      'proposed cleanup: s',
      '',
      'outcome: ABANDONED — assertion-would-change',
      '  the cleanup could only reach green by changing an existing assertion in a.test.js. ' +
        'That is a behaviour change wearing a refactor\'s clothes, so it is abandoned: this item needs its own ticket.',
      '  nothing was committed; the working tree is unchanged.',
      '',
    ].join('\n')
  );
});

test('BL-1015 report: ABANDONED for gate-failed names the failed gate, and "unknown" when gate itself is null', () => {
  const withGate = {
    outcome: 'abandoned', reason: 'gate-failed', subject: 'a.ts', summary: 's',
    measured: { files: 1, lines: 5 }, envelope: { files: 3, lines: 120 }, exceeded: [],
    editedPaths: ['a.ts'], committed: false, gate: { passed: false, ran: ['unit'], failed: ['unit'] },
    ranked: 1, detail: null,
  };
  assert.ok(
    renderRunReport(withGate).includes('the repository gate set failed on the cleaned result (failed: unit).'),
  );
  const noGate = { ...withGate, gate: null };
  assert.ok(
    renderRunReport(noGate).includes('the repository gate set failed on the cleaned result (failed: unknown).'),
    'the optional chaining on result.gate?.failed matters when gate is null'
  );
});

test('BL-1015 report: a no-cleanup-proposed refusal names the subject, with and without a detail parenthetical', () => {
  const withDetail = {
    outcome: 'nothing-to-do', reason: 'no-cleanup-proposed', subject: 'a.ts', summary: null,
    measured: { files: 0, lines: 0 }, envelope: { files: 3, lines: 120 }, exceeded: [],
    editedPaths: [], committed: false, gate: null, ranked: 1, detail: 'the proposal changes nothing',
  };
  assert.ok(renderRunReport(withDetail).includes('no cleanup was proposed for a.ts (the proposal changes nothing).'));
  const withoutDetail = { ...withDetail, detail: null };
  assert.ok(
    renderRunReport(withoutDetail).includes('no cleanup was proposed for a.ts.'),
    'no detail at all must render with no trailing parenthetical, not a placeholder'
  );
});

test('BL-1015 report: a reason outside the declared set renders the defensive fallback, not a crash', () => {
  // Unreachable by construction in a real run - every no-clean path sets a
  // declared reason - but explain()'s dispatch-table lookup must still
  // handle a missing key defensively rather than throwing. Bypasses the
  // NoCleanReason type deliberately (this is a plain JS test file) to
  // exercise the fallback directly.
  const result = {
    outcome: 'refused', reason: 'not-a-declared-reason', subject: 'a.ts', summary: null,
    measured: { files: 0, lines: 0 }, envelope: { files: 3, lines: 120 }, exceeded: [],
    editedPaths: [], committed: false, gate: null, ranked: 1, detail: null,
  };
  assert.ok(
    renderRunReport(result).includes('no reason was recorded, which is itself a defect'),
    'a reason the formatter table does not know must fall back, not throw'
  );
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
  assert.equal(result.output, 'ENOENT', 'the spawn error message must reach the report, not be swallowed');
});

test('BL-1015: a gate with no output at all contributes nothing - a falsy-guard removed would insert a stray blank line', () => {
  const result = runDeclaredGates(
    '/root',
    [
      { name: 'unit', command: 'a', args: [], cwd: '.' },
      { name: 'lint', command: 'b', args: [], cwd: '.' },
    ],
    () => ({ status: 0, output: '' })
  );
  assert.equal(result.output, '', 'two gates with empty output must not join into a bare newline');
});

test('BL-1015: runDeclaredGates reports passed=true, and joins every gate\'s output with a newline, when everything succeeds', () => {
  const result = runDeclaredGates(
    '/root',
    [
      { name: 'unit', command: 'a', args: [], cwd: '.' },
      { name: 'lint', command: 'b', args: [], cwd: '.' },
    ],
    (cmd) => ({ status: 0, output: `${cmd}-output` })
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.failed, []);
  assert.equal(result.output, 'a-output\nb-output', 'each gate\'s output is on its own line, not concatenated bare');
});

test('BL-1015: DEFAULT_GATE_COMMANDS is the literal npm test in extension, not merely non-empty', () => {
  assert.deepEqual(DEFAULT_GATE_COMMANDS, [{ name: 'unit', command: 'npm', args: ['test'], cwd: 'extension' }]);
});

test('BL-1015: defaultGateSpawn runs a real command and concatenates BOTH stdout and stderr, in utf8', () => {
  const outcome = defaultGateSpawn(
    process.execPath,
    ['-e', "process.stdout.write('out-line'); process.stderr.write('err-line');"],
    '.'
  );
  assert.equal(outcome.status, 0);
  assert.equal(outcome.output, 'out-lineerr-line', 'stdout and stderr must both appear, not one dropped by a falsy-guard');
  assert.equal(typeof outcome.output, 'string', 'utf8 encoding must decode to a real string, not a Buffer');
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

test('BL-1015: the trailing empty segment after a null-terminated git ls-files reply is never treated as a tracked path', () => {
  // `git ls-files -z` NULL-terminates every entry, so splitting on '\0'
  // always leaves one trailing empty string in the array - the filter
  // exists to drop exactly that artifact. Pass an actual empty-string path
  // to observe it: unfiltered, that stray '' would land in `tracked` and
  // make this genuinely-untracked path look tracked, skipping `git add`.
  const spawned = [];
  commitEdits('/repo', 'm', [''], (command, args, cwd) => {
    spawned.push({ command, args, cwd });
    return { status: 0, output: '' };
  });
  assert.deepEqual(spawned.map((s) => s.args[0]), ['ls-files', 'add', 'commit'],
    'the empty-string path is genuinely untracked (git ls-files replied with nothing) and must still be staged');
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

test('BL-1015: ls-files status and error are both independently checked, and neither alone is trusted', () => {
  // A nonzero status alone (no error object) must still fall back to "stage
  // everything" - checked against output that would otherwise be misread as
  // this path being tracked, so the fallback is observable rather than
  // coincidentally matching the non-fallback parse.
  const spawnedA = [];
  commitEdits('/repo', 'm', ['src/a.ts', 'src/b.ts'], (_c, args) => {
    spawnedA.push(args);
    if (args[0] === 'ls-files') return { status: 1, output: 'src/a.ts\0' };
    return { status: 0, output: '' };
  });
  assert.deepEqual(spawnedA[1], ['add', '--', 'src/a.ts', 'src/b.ts'], 'a nonzero status alone must still fall back to staging both paths');

  // A ZERO status but a truthy .error must ALSO fall back - the two conditions
  // are independent, not ANDed.
  const spawnedB = [];
  commitEdits('/repo', 'm', ['src/a.ts', 'src/b.ts'], (_c, args) => {
    spawnedB.push(args);
    if (args[0] === 'ls-files') return { status: 0, error: new Error('weird'), output: 'src/a.ts\0' };
    return { status: 0, output: '' };
  });
  assert.deepEqual(spawnedB[1], ['add', '--', 'src/a.ts', 'src/b.ts'], 'status 0 with an error object must still fall back to staging both paths');
});

test('BL-1015: unstage short-circuits on an empty path list rather than spawning a no-op git reset', () => {
  // Reached when every edited path was already tracked and the commit still
  // fails - created is [] and unstage must not spawn `git reset --` with an
  // empty pathspec.
  const spawned = [];
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['src/tracked.ts'], (_c, args) => {
        spawned.push(args);
        if (args[0] === 'ls-files') return { status: 0, output: 'src/tracked.ts\0' };
        if (args[0] === 'commit') return { status: 1, output: 'refused' };
        return { status: 0, output: '' };
      }),
    /git commit failed/
  );
  assert.ok(!spawned.some((a) => a[0] === 'reset'), 'nothing was staged by this run, so nothing should be reset');
});

test('BL-1015: the empty-path-list unstage shortcut reports SUCCESS, not a phantom failure', () => {
  // Nothing was staged (the one edited path was already tracked), so there is
  // nothing to unstage. If that shortcut ever reported failure, a totally
  // untouched index would get an incorrect "could not unstage" warning
  // appended onto the real commit failure below.
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['src/tracked.ts'], (_c, args) => {
        if (args[0] === 'ls-files') return { status: 0, output: 'src/tracked.ts\0' };
        if (args[0] === 'commit') return { status: 1, output: 'refused' };
        return { status: 0, output: '' };
      }),
    (err) => err.message === 'git commit failed: refused',
    'no WARNING suffix - nothing was staged, so the unstage trivially succeeded'
  );
});

test('BL-1015: a successful unstage leaves NO warning suffix at all - the empty string, not a placeholder', () => {
  const spawned = [];
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['src/created.ts'], (_c, args) => {
        spawned.push(args);
        if (args[0] === 'ls-files') return { status: 0, output: '' };
        if (args[0] === 'commit') return { status: 1, output: 'refused' };
        if (args[0] === 'reset') return { status: 0, output: '' };
        return { status: 0, output: '' };
      }),
    (err) => err.message === 'git commit failed: refused'
  );
});

test('BL-1015: a reset that reports status 0 but carries an error object still counts as an unstage failure', () => {
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['src/created.ts'], (_c, args) => {
        if (args[0] === 'ls-files') return { status: 0, output: '' };
        if (args[0] === 'commit') return { status: 1, output: 'refused' };
        if (args[0] === 'reset') return { status: 0, error: new Error('leftover lock'), output: '' };
        return { status: 0, output: '' };
      }),
    /could not unstage src\/created\.ts/
  );
});

test('BL-1015: the WARNING names every left-staged path joined by comma-space, not concatenated bare', () => {
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['src/a.ts', 'src/b.ts'], (_c, args) => {
        if (args[0] === 'ls-files') return { status: 0, output: '' };
        if (args[0] === 'commit') return { status: 1, output: 'refused' };
        if (args[0] === 'reset') return { status: 1, output: 'reset refused' };
        return { status: 0, output: '' };
      }),
    /could not unstage src\/a\.ts, src\/b\.ts/
  );
});

test('BL-1015: a git add failure reports the real output text, not a coalesced empty string', () => {
  assert.throws(
    () =>
      commitEdits('/repo', 'm', ['a.ts'], (_c, args) => {
        if (args[0] === 'ls-files') return { status: 0, output: '' };
        if (args[0] === 'add') return { status: 1, output: 'nothing to add' };
        return { status: 0, output: '' };
      }),
    (err) => err.message === 'git add failed: nothing to add'
  );
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
