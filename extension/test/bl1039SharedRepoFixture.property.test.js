// BL-1039 property test (coder-authored). Two of the three DECLARED invariants
// are encoded here; the third's stated reason is at the bottom of this header.
//
//   Invariant 1: "No unit-lane test creates a git repository of its own: a
//   repository comes from the shared seeded fixture, so the seeding cost is
//   paid once per run rather than once per scenario."
//
//   Invariant 2: "A shared fixture never leaks state between tests: no test
//   observes a commit, ref, or working-tree change made by another."
//
// Invariant 2 is the one that carries the risk. Sharing is the whole saving,
// and a fixture that leaked one test's commits into another's view would have
// traded a slow suite for a LYING one - a far worse outcome than a slow suite.
// So P2 quantifies over the thing that could actually go wrong: many callers,
// arbitrary writes by arbitrary subsets of them, checked in both directions.
//
// REACH, asserted rather than hoped for (BL-654's generator-reach clause).
// Leakage cannot be observed unless somebody WRITES: a generator drawing
// "does this caller commit?" at even odds would spend runs where nobody wrote
// and the property held vacuously. Every run therefore has at least one
// writer BY CONSTRUCTION, and a floor asserts both multi-writer runs and
// single-writer runs were reached. Order is generated too, because an
// isolation that only holds when the writer went first is not isolation.
//
//   INVARIANT 3 ("speed is never bought with coverage") is NOT encoded here,
//   and the reason is stated rather than left implicit: it quantifies over
//   successive suite runs recorded in .test-durations.jsonl and over a diff
//   against a parent commit - process facts about this repository's history,
//   not properties of any pure module. No generator over module inputs can
//   observe them. It is checked by this ticket's qa_e2e, and its "nothing
//   skipped or deleted" half is asserted in scenario 06's handler.
//
// Non-vacuity PROVEN at authoring time (2026-08-22), each break restored, and
// each bites its OWN invariant - which is the point of having two:
//   all callers share one directory ............ invariant 2 FAILS (1 alone passes)
//   guard stops separating data from a call .... invariant 1 FAILS (2 alone passes)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkoutSeededRepo, seedCount, resetForTest } = require('./helpers/sharedRepoFixture');
const { createsRepository, exemptionReason, violationFor } = require('./helpers/repoCreationGuard');

// Invariant 2 does REAL git work per run - several checkouts, real commits -
// so its run count is sized to this host rather than to a round number, and it
// carries an explicit timeout. It is not a cheap pure property and pretending
// otherwise just makes it flake under contention (this host swings 3x, which
// is the disease BL-1007 exists to cure). Invariant 1 is pure text and runs
// far more.
const RUNS = Number(process.env.PROPERTY_RUNS || 14);
const IO_TIMEOUT_MS = 120000;

function makeRng(seed) {
  let s = seed;
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return Math.floor(s / 65536) % Math.max(1, n);
  };
}

const subjects = (dir) =>
  execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');

test('BL-1039 invariant 2: no caller ever observes another caller\'s writes', () => {
  const rng = makeRng(1039);
  const coverage = { multiWriter: 0, singleWriter: 0, writerFirst: 0, writerLast: 0 };

  for (let r = 0; r < RUNS; r++) {
    const n = 2 + rng(4);
    const dirs = Array.from({ length: n }, (_, i) => checkoutSeededRepo(`bl1039-p${r}-${i}-`));
    try {
      // At least one writer BY CONSTRUCTION - leakage is unobservable without
      // one, and a generator that sometimes had none would hold vacuously.
      const writers = new Set([rng(n)]);
      for (let i = 0; i < n; i++) if (rng(3) === 0) writers.add(i);
      if (writers.size > 1) coverage.multiWriter += 1; else coverage.singleWriter += 1;
      if (writers.has(0)) coverage.writerFirst += 1;
      if (writers.has(n - 1)) coverage.writerLast += 1;

      for (const i of writers) {
        fs.writeFileSync(path.join(dirs[i], `w${i}.txt`), 'x');
        execFileSync('git', ['-C', dirs[i], 'add', '-A']);
        execFileSync('git', ['-C', dirs[i], 'commit', '-q', '-m', `write-${i}`]);
      }

      for (let i = 0; i < n; i++) {
        const log = subjects(dirs[i]);
        if (writers.has(i)) {
          assert.ok(log.includes(`write-${i}`), `run ${r}: a writer must see its OWN commit`);
        } else {
          assert.deepEqual(log, ['init'],
            `run ${r}: a non-writer must observe the seeded history ONLY, got ${log.join(', ')}`);
        }
        // And never anyone else's, in either direction.
        for (const j of writers) {
          if (j === i) continue;
          assert.ok(!log.includes(`write-${j}`), `run ${r}: caller ${i} saw caller ${j}'s commit`);
          assert.ok(!fs.existsSync(path.join(dirs[i], `w${j}.txt`)),
            `run ${r}: caller ${i} saw caller ${j}'s file`);
        }
      }
    } finally {
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    }
  }

  // Floors scaled to the run count, not copied from a larger one - a floor
  // that cannot be met is just a red suite.
  assert.ok(coverage.multiWriter >= 3, `multi-writer runs reached only ${coverage.multiWriter}`);
  assert.ok(coverage.singleWriter >= 2, `single-writer runs reached only ${coverage.singleWriter}`);
  assert.ok(coverage.writerFirst >= 2, `a writer taking the FIRST copy reached only ${coverage.writerFirst}`);
  assert.ok(coverage.writerLast >= 2, `a writer taking the LAST copy reached only ${coverage.writerLast}`);
}, IO_TIMEOUT_MS);

test('BL-1039 invariant 1: the guard names direct creation and only direct creation', () => {
  const rng = makeRng(2039);
  const coverage = { creates: 0, shared: 0, dataOnly: 0, exempt: 0, bare: 0 };

  for (let r = 0; r < 400; r++) {
    const kind = rng(4);
    let text;
    let shouldFlag;
    if (kind === 0) {
      text = `execFileSync('git', ['init', '-q'], { cwd: root });`;
      shouldFlag = true;
      coverage.creates += 1;
    } else if (kind === 1) {
      text = "copySeededRepoInto(root);";
      shouldFlag = false;
      coverage.shared += 1;
    } else if (kind === 2) {
      // A guard test's fixture STRING - data, not a call. The same
      // executing-vs-asserting distinction BL-1032 existed to draw.
      text = `  "execFileSync('git', ['init', '-q'], { cwd: root });",`;
      shouldFlag = false;
      coverage.dataOnly += 1;
    } else {
      const bare = rng(2) === 0;
      text = bare
        ? `// BL-1039-EXEMPT:\nexecFileSync('git', ['init', '-q'], { cwd: root });`
        : `// BL-1039-EXEMPT: drives real git plumbing, which is the subject\nexecFileSync('git', ['init', '-q'], { cwd: root });`;
      shouldFlag = bare;
      if (bare) coverage.bare += 1; else coverage.exempt += 1;
    }
    assert.equal(Boolean(violationFor('x.test.js', text)), shouldFlag,
      `run ${r} kind ${kind}: ${JSON.stringify(text)}`);
  }

  assert.ok(coverage.creates >= 30, `direct creations reached only ${coverage.creates}`);
  assert.ok(coverage.shared >= 30, `shared-fixture files reached only ${coverage.shared}`);
  assert.ok(coverage.dataOnly >= 30, `data-only fixtures reached only ${coverage.dataOnly}`);
  assert.ok(coverage.exempt >= 10, `justified exemptions reached only ${coverage.exempt}`);
  assert.ok(coverage.bare >= 10, `bare markers reached only ${coverage.bare}`);
});
