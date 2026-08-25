// BL-1015 property test (coder-authored, THREE declared invariants).
//
//   Invariant 1 (bounded and verified): a run cleans at most ONE item, never
//   exceeding the declared size envelope, and commits only after the
//   repository's existing gate set passes on the cleaned result. Oversized, or
//   failing a gate, is refused whole - never partially applied and never
//   committed.
//   Invariant 2 (tests are not the thing being cleaned): a run never edits an
//   existing test assertion to reach green.
//   Invariant 3 (never silently empty): a run that cleans nothing states which
//   reason applied.
//
// WHY PROPERTIES AND NOT MORE FIXTURES. All three quantify over "every cleanup
// this run could possibly attempt". Six example scenarios pin six shapes; the
// bug that matters is the seventh - an unusual proposal that slips past one
// check because the checks happen in the wrong order.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// Two states are the ones a naive generator would essentially never produce:
//
//   (a) THE ENVELOPE BOUNDARY. Drawing file counts and line counts
//       independently puts almost every case far inside or far outside the
//       envelope, so an off-by-one on the limit (`>=` for `>`) would survive
//       any number of runs. Exactly-at-the-limit proposals are therefore
//       CONSTRUCTED - 3 files x 40 lines - and a floor asserts they occurred.
//
//   (b) AN EDIT THAT WOULD CHANGE AN EXISTING ASSERTION. This is the collision
//       shape BL-654 warns about: drawing a test file's new content
//       independently of its old content would collide with a real assertion
//       essentially never. So the offending `after` is DERIVED from the file's
//       own current content by rewriting one of its assertion lines - every
//       such case is an assertion-change candidate by construction. Its
//       near-miss twin (reformat around the assertions, add a new one, keep
//       every existing one verbatim) is generated alongside, because a guard
//       that fired on ANY test-file edit would also pass invariant 2 while
//       being useless.
//
// Every outcome and every declared reason carries its own floor, so a
// generator change that quietly stops producing gate failures - or stops
// producing successful cleanups, which would make invariants 1 and 2 vacuous -
// fails this file rather than passing it.
//
// NON-VACUITY PROVEN at authoring time (2026-08-22), each break applied to
// src/tools/boyScoutRun.ts, compiled, run, and reverted:
//
//   envelope checked AFTER the edits are applied
//       -> inv 1: "refused or abandoned means refused WHOLE - the working
//          tree is exactly as it was" (run 13, shape too-many-lines)
//   commit issued regardless of gate.passed
//       -> inv 1: "a commit only ever follows a PASSING gate set" (run 6)
//   gate failure returns without restoring the tree
//       -> inv 1: the working-tree assertion again (run 6, shape in-range)
//   the assertion guard removed entirely
//       -> inv 2: "an existing test assertion disappeared from
//          extension/test/s0.test.js: assert.equal(clean(0), 0);" (run 7)
//   a no-proposal run returns with reason left null
//       -> inv 3: "a run that cleaned nothing must state a reason" (run 3)
//
// Each break was applied to src/tools/boyScoutRun.ts, compiled, run against
// this file, and reverted; none of the five survived.
//
// ADDED after the architect's send-back #1 (2026-08-22), which found this
// generator never made the COMMIT fail: invariant 1's "never partially
// applied" was reaching the paths that refuse before the first write and the
// failing-gate path, but never the one path that writes, passes its gates,
// and then cannot commit. `commitThrows` now generates that arm (~1 in 5
// cases) with its own reach floor, and the assertion is that the working tree
// came back. Break proven the same way:
//
//   the commit-failure catch rethrows WITHOUT calling restore()
//       -> inv 1: "a commit that FAILED must leave the working tree exactly
//          as it was" (run 0, shape trespass)
//
// The INDEX half of that same defect cannot be reached from here at all - this
// harness's `writeFile` is an in-memory Map with no git index behind it - so it
// is covered fixture-level, against a real temp repository with a real refusing
// pre-commit hook, in boyScoutRunCommitIndex.test.js.

const assert = require('node:assert/strict');

const {
  SIZE_ENVELOPE,
  NO_CLEAN_REASONS,
  assertionLines,
  isTestPath,
  boyScoutRun,
  renderRunReport,
} = require('../out/tools/boyScoutRun');

const RUNS = Number(process.env.PROPERTY_RUNS || 300);

function makeRng(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return Math.floor(s / 65536) % Math.max(1, n);
  };
}

const SUBJECTS = ['src/s0.ts', 'src/s1.ts', 'src/s2.ts'];
const TEST_FILE = 'extension/test/s0.test.js';

function body(n, prefix) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n');
}

function debtItem(subject, sourceCount) {
  return {
    subject,
    sourceCount,
    evidence: [{ subject, source: 'duplication', artifact: 'jscpd', detail: `${subject} clone` }],
  };
}

// ── the generated case ────────────────────────────────────────────────────

// Weighted so every branch of the run is reached often enough for its floor.
const SHAPES = [
  'in-range',
  'in-range',
  'in-range',
  'at-the-limit',
  'too-many-files',
  'too-many-lines',
  'wrong-item',
  'trespass',
  'assertion-rewritten',
  'assertion-preserved',
  'no-proposal',
  'no-op-edits',
];

function seedTree(rng) {
  const tree = new Map();
  for (const subject of SUBJECTS) tree.set(subject, body(20 + rng(30), 'code'));
  // A real test file with a real, varying number of real assertions - the
  // thing invariant 2 is about. Two of them are deliberately IDENTICAL some of
  // the time, so the multiset (rather than set) reading of "an assertion was
  // removed" is exercised too.
  const assertionCount = 1 + rng(3);
  const testLines = ["test('seeded', () => {"];
  for (let i = 0; i < assertionCount; i++) testLines.push(`  assert.equal(clean(${i}), ${i});`);
  if (rng(3) === 0) testLines.push(`  assert.equal(clean(0), 0);`);
  testLines.push('});');
  tree.set(TEST_FILE, testLines.join('\n') + '\n');
  return tree;
}

function buildProposal(shape, rng, top, ranked, tree) {
  const edits = [];
  switch (shape) {
    case 'in-range': {
      const fileCount = 1 + rng(SIZE_ENVELOPE.files);
      for (let i = 0; i < fileCount; i++) {
        edits.push({ path: `src/new${i}.ts`, after: body(1 + rng(30), 'tidy') });
      }
      break;
    }
    case 'at-the-limit': {
      // Constructed, never drawn: exactly 3 files and exactly 120 lines. An
      // off-by-one on either limit is only visible right here.
      for (let i = 0; i < SIZE_ENVELOPE.files; i++) {
        edits.push({ path: `src/limit${i}.ts`, after: body(SIZE_ENVELOPE.lines / SIZE_ENVELOPE.files, 'edge') });
      }
      break;
    }
    case 'too-many-files': {
      for (let i = 0; i < SIZE_ENVELOPE.files + 1 + rng(3); i++) {
        edits.push({ path: `src/wide${i}.ts`, after: body(1 + rng(5), 'wide') });
      }
      break;
    }
    case 'too-many-lines':
      edits.push({ path: 'src/long.ts', after: body(SIZE_ENVELOPE.lines + 1 + rng(300), 'long') });
      break;
    case 'wrong-item':
      // A proposal for a ranked item that is NOT the top one.
      return {
        subject: ranked.length > 1 ? ranked[1].subject : `${top.subject}.other`,
        summary: 'for the wrong item',
        edits: [{ path: 'src/new0.ts', after: body(5, 'tidy') }],
      };
    case 'trespass':
      edits.push({ path: 'src/new0.ts', after: body(5, 'tidy') });
      if (ranked.length > 1) edits.push({ path: ranked[1].subject, after: body(5, 'meddle') });
      break;
    case 'assertion-rewritten': {
      // DERIVED from the file's own content: take a real assertion line out of
      // the real test file and reword it. Drawn independently, a generated
      // `after` would collide with a real assertion essentially never.
      const before = tree.get(TEST_FILE);
      const existing = assertionLines(before);
      const target = existing[rng(existing.length)];
      const after = before.replace(target, target.replace('clean(', 'tidy('));
      edits.push({ path: 'src/new0.ts', after: body(3, 'tidy') });
      edits.push({ path: TEST_FILE, after });
      break;
    }
    case 'assertion-preserved': {
      // The near miss: the same test file is edited, but every existing
      // assertion survives verbatim. A guard that fired on any test-file edit
      // at all would satisfy invariant 2 while being useless, so this shape
      // has to reach `cleaned`.
      const before = tree.get(TEST_FILE);
      const after = `// a comment the cleanup added\n${before}  assert.ok(true);\n`;
      edits.push({ path: TEST_FILE, after });
      break;
    }
    case 'no-proposal':
      return null;
    case 'no-op-edits':
      edits.push({ path: SUBJECTS[0], after: tree.get(SUBJECTS[0]) });
      break;
    default:
      throw new Error(`unknown proposal shape ${shape}`);
  }
  return { subject: top.subject, summary: `${shape} cleanup`, edits };
}

function runCase(rng) {
  const tree = seedTree(rng);
  const before = new Map(tree);

  const rankedCount = rng(4); // 0..3 - zero is the empty-inventory case
  const ranked = SUBJECTS.slice(0, rankedCount).map((s, i) => debtItem(s, 3 - i));
  const shape = SHAPES[rng(SHAPES.length)];
  const gatePasses = rng(4) !== 0;
  // BL-1015 architect send-back #1: this generator never made the COMMIT
  // fail, so invariant 1's "never partially applied" was only ever exercised
  // on the paths that refuse BEFORE the first write, or on a failing gate -
  // never on the one path that writes, passes, and then cannot commit. A
  // pre-commit hook refusing is the ticket's own named example.
  const commitThrows = rng(5) === 0;

  const calls = { proposedFor: [], gateRuns: 0, commits: 0, order: [] };
  const env = {
    scanRepository: () => ({ ranked, consulted: [] }),
    propose: (top) => {
      calls.proposedFor.push(top.subject);
      return buildProposal(shape, rng, top, ranked, tree);
    },
    readFile: (_root, p) => (tree.has(p) ? tree.get(p) : null),
    writeFile: (_root, p, content) => {
      if (content === null) tree.delete(p);
      else tree.set(p, content);
    },
    runGates: () => {
      calls.gateRuns += 1;
      calls.order.push('gate');
      return gatePasses
        ? { passed: true, ran: ['unit'], failed: [] }
        : { passed: false, ran: ['unit'], failed: ['unit'] };
    },
    commit: () => {
      calls.commits += 1;
      calls.order.push('commit');
      if (commitThrows) throw new Error('git commit failed: pre-commit hook refused');
    },
  };

  let result = null;
  let thrown = null;
  try {
    result = boyScoutRun('/root', env);
  } catch (err) {
    thrown = err;
  }
  return { result, thrown, tree, before, ranked, calls, shape, gatePasses, commitThrows };
}

function multisetCounts(list) {
  const counts = new Map();
  for (const entry of list) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  return counts;
}

function treesEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (!b.has(k) || b.get(k) !== v) return false;
  return true;
}

// ── the properties ────────────────────────────────────────────────────────

test('BL-1015 invariants 1-3 hold over every cleanup the run could attempt', () => {
  const reached = new Map();
  const bump = (key) => reached.set(key, (reached.get(key) ?? 0) + 1);
  let seededAssertions = 0;

  for (let runIndex = 0; runIndex < RUNS; runIndex++) {
    const rng = makeRng(runIndex * 7919 + 13);
    const { result, thrown, tree, before, ranked, calls, shape, gatePasses, commitThrows } = runCase(rng);
    const where = `run ${runIndex} (shape ${shape}, gate ${gatePasses ? 'passes' : 'fails'})`;

    // ── invariant 1 on the one path that writes and then cannot commit ────
    if (thrown) {
      bump('commit-threw');
      assert.equal(commitThrows, true,
        `${where}: the run threw for something other than the injected commit failure: ${thrown.message}`);
      assert.match(thrown.message, /git commit failed/,
        `${where}: the commit failure must reach the caller, not be swallowed into a success`);
      assert.equal(calls.commits, 1, `${where}: at most one commit attempt per run`);
      assert.ok(treesEqual(tree, before),
        `${where}: a commit that FAILED must leave the working tree exactly as it was - ` +
        'neither as-it-was-plus-the-edits nor committed');
      seededAssertions += assertionLines(before.get(TEST_FILE)).length;
      continue;
    }

    bump(`outcome:${result.outcome}`);
    bump(`reason:${result.reason}`);
    if (result.measured.files === SIZE_ENVELOPE.files && result.measured.lines === SIZE_ENVELOPE.lines) {
      bump('at-the-limit');
    }
    seededAssertions += assertionLines(before.get(TEST_FILE)).length;

    // ── invariant 1: bounded and verified ────────────────────────────────

    assert.ok(calls.proposedFor.length <= 1, `${where}: a run considers at most ONE item`);
    if (ranked.length > 0) {
      assert.deepEqual(calls.proposedFor, [ranked[0].subject],
        `${where}: the one item considered is always the TOP-ranked one`);
    }

    assert.ok(result.measured.files <= SIZE_ENVELOPE.files || result.outcome !== 'cleaned',
      `${where}: a cleaned run never exceeds the ${SIZE_ENVELOPE.files}-file envelope`);
    assert.ok(result.measured.lines <= SIZE_ENVELOPE.lines || result.outcome !== 'cleaned',
      `${where}: a cleaned run never exceeds the ${SIZE_ENVELOPE.lines}-line envelope`);

    assert.ok(calls.commits <= 1, `${where}: at most one commit per run`);
    if (calls.commits === 1) {
      assert.equal(gatePasses, true, `${where}: a commit only ever follows a PASSING gate set`);
      assert.deepEqual(calls.order, ['gate', 'commit'],
        `${where}: the gate set runs on the cleaned result, before the commit`);
      assert.equal(result.outcome, 'cleaned');
      assert.equal(result.committed, true);
    }
    if (result.outcome !== 'cleaned') {
      assert.equal(calls.commits, 0, `${where}: nothing is committed unless the run cleaned`);
      assert.equal(result.committed, false);
      assert.ok(treesEqual(tree, before),
        `${where}: refused or abandoned means refused WHOLE - the working tree is exactly as it was`);
    }

    // ── invariant 2: tests are not the thing being cleaned ───────────────

    for (const [relPath, content] of before) {
      if (!isTestPath(relPath)) continue;
      const had = multisetCounts(assertionLines(content));
      if (had.size === 0) continue;
      const now = multisetCounts(assertionLines(tree.get(relPath) ?? ''));
      for (const [line, count] of had) {
        assert.ok((now.get(line) ?? 0) >= count,
          `${where}: an existing test assertion disappeared from ${relPath}: ${line}`);
      }
    }

    // ── invariant 3: never silently empty ────────────────────────────────

    const report = renderRunReport(result);
    if (result.outcome === 'cleaned') {
      assert.equal(result.reason, null, `${where}: a cleaned run carries no no-clean reason`);
    } else {
      assert.ok(result.reason !== null, `${where}: a run that cleaned nothing must state a reason`);
      assert.ok(NO_CLEAN_REASONS.includes(result.reason),
        `${where}: the reason must come from the declared set, got ${result.reason}`);
      assert.ok(report.includes(result.reason),
        `${where}: and the report a human reads must carry it, not just the return value`);
    }
    assert.ok(report.trim().length > 0, `${where}: a run always reports`);
  }

  // ── reach, asserted rather than hoped for ──────────────────────────────

  const floor = (key, min) =>
    assert.ok((reached.get(key) ?? 0) >= min,
      `generator reach: ${key} was produced ${reached.get(key) ?? 0} times, needed >= ${min}. ` +
      'A property that never reaches a state proves nothing about it.');

  floor('outcome:cleaned', 20);
  floor('outcome:refused', 20);
  floor('outcome:abandoned', 20);
  floor('outcome:nothing-to-do', 20);
  for (const reason of NO_CLEAN_REASONS) floor(`reason:${reason}`, 5);
  floor('at-the-limit', 3);
  floor('commit-threw', 5);
  assert.ok(seededAssertions >= RUNS,
    'every generated case must seed at least one real assertion, or invariant 2 is vacuous');
});
