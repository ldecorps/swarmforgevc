const assert = require('node:assert/strict');
const { computeCoChangeReport } = require('../out/quality/coChange');

// BL-255: automates the architect's manual Feathers co-change check
// (architect.prompt:32-37) over git history. Pure over GitLogEntry[] -
// reuses gitHistoryAdapter.ts's own parseGitLog/GitLogEntry shape (the
// SAME injectable seam BL-096's delivery metrics already established for
// "no live git in unit tests"), never a second git-log parser. Every test
// here feeds a hand-built GitLogEntry[] fixture directly; nothing shells
// out to git.

function commit(hash, dateIso, paths) {
  return { commit: hash, dateIso, changes: paths.map((path) => ({ status: 'M', path })) };
}

function ranked(report, file) {
  return report.find((r) => r.file === file).coChangers;
}

// ── ranks-cochangers-01 ──────────────────────────────────────────────────

test('files are ranked by how often they co-change with the file under review', () => {
  const history = [
    commit('c1', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts']),
    commit('c2', '2026-07-02T00:00:00Z', ['A.ts', 'B.ts']),
    commit('c3', '2026-07-03T00:00:00Z', ['A.ts', 'B.ts']),
    commit('c4', '2026-07-04T00:00:00Z', ['A.ts', 'C.ts']),
  ];
  const report = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 2 });
  const coChangers = ranked(report, 'A.ts');
  assert.deepEqual(coChangers.map((c) => c.file), ['B.ts', 'C.ts']);
  assert.equal(coChangers[0].count, 3);
  assert.equal(coChangers[1].count, 1);
});

test('a file with no co-changers at all reports an empty list, never a crash', () => {
  const history = [commit('c1', '2026-07-01T00:00:00Z', ['A.ts'])];
  const report = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 1 });
  assert.deepEqual(ranked(report, 'A.ts'), []);
});

test('one report entry is returned per changed file under review, in the given order', () => {
  const history = [commit('c1', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts', 'C.ts'])];
  const report = computeCoChangeReport(['C.ts', 'A.ts'], history, { minFrequency: 1, minGroupSize: 1 });
  assert.deepEqual(report.map((r) => r.file), ['C.ts', 'A.ts']);
});

// ── threshold-flags-coupling-02 ──────────────────────────────────────────

test('a pair at or above minFrequency is flagged coupled; a pair below it is not', () => {
  const history = [
    commit('c1', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts']),
    commit('c2', '2026-07-02T00:00:00Z', ['A.ts', 'B.ts']),
    commit('c3', '2026-07-03T00:00:00Z', ['A.ts', 'B.ts']),
    commit('c4', '2026-07-04T00:00:00Z', ['A.ts', 'C.ts']),
  ];
  const report = computeCoChangeReport(['A.ts'], history, { minFrequency: 3, minGroupSize: 1 });
  const coChangers = ranked(report, 'A.ts');
  assert.equal(coChangers.find((c) => c.file === 'B.ts').coupled, true, 'count 3 >= threshold 3 must be flagged');
  assert.equal(coChangers.find((c) => c.file === 'C.ts').coupled, false, 'count 1 < threshold 3 must not be flagged');
});

test('a pair exactly AT the threshold is flagged (inclusive, "at or above")', () => {
  const history = [commit('c1', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts'])];
  const report = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 1 });
  assert.equal(ranked(report, 'A.ts')[0].coupled, true);
});

// ── surfaces-import-invisible-coupling-03 ────────────────────────────────
// The tool derives coupling PURELY from co-occurrence in commits - it never
// reads or reasons about import statements, so a frequently co-changing
// pair is reported as coupled regardless of whether any import links them
// (this is inherent to the design, not a special case to branch on).

test('two files with no import relationship (irrelevant to this pure git-history function) are still reported as coupled from co-change alone', () => {
  const history = [
    commit('c1', '2026-07-01T00:00:00Z', ['unrelatedA.ts', 'unrelatedB.ts']),
    commit('c2', '2026-07-02T00:00:00Z', ['unrelatedA.ts', 'unrelatedB.ts']),
    commit('c3', '2026-07-03T00:00:00Z', ['unrelatedA.ts', 'unrelatedB.ts']),
  ];
  const report = computeCoChangeReport(['unrelatedA.ts'], history, { minFrequency: 3, minGroupSize: 1 });
  assert.equal(ranked(report, 'unrelatedA.ts')[0].coupled, true);
});

// ── window-is-tunable-04 ──────────────────────────────────────────────────

test('a history window of N most recent commits excludes older commits from the count', () => {
  const history = [
    commit('old1', '2026-01-01T00:00:00Z', ['A.ts', 'B.ts']),
    commit('old2', '2026-01-02T00:00:00Z', ['A.ts', 'B.ts']),
    commit('recent1', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts']),
  ];
  const windowed = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 1, windowCommits: 1 });
  assert.equal(ranked(windowed, 'A.ts')[0].count, 1, 'only the 1 most recent commit should count');

  const full = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 1 });
  assert.equal(ranked(full, 'A.ts')[0].count, 3, 'with no window, every commit counts');
});

test('the window selects the MOST RECENT commits by date, not input order', () => {
  const history = [
    commit('recent', '2026-07-05T00:00:00Z', ['A.ts', 'B.ts']),
    commit('old', '2026-01-01T00:00:00Z', ['A.ts', 'C.ts']),
  ];
  const report = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 1, windowCommits: 1 });
  assert.deepEqual(ranked(report, 'A.ts').map((c) => c.file), ['B.ts']);
});

// ── deterministic-ordering-05 ─────────────────────────────────────────────

test('running the analysis twice on identical inputs produces a byte-identical report', () => {
  const history = [
    commit('c1', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts']),
    commit('c2', '2026-07-02T00:00:00Z', ['A.ts', 'C.ts']),
    commit('c3', '2026-07-03T00:00:00Z', ['A.ts', 'D.ts']),
  ];
  const first = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 1 });
  const second = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 1 });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('tied co-change counts break ties deterministically by file name, not insertion order', () => {
  const history = [
    commit('c1', '2026-07-03T00:00:00Z', ['A.ts', 'Z.ts']),
    commit('c2', '2026-07-01T00:00:00Z', ['A.ts', 'M.ts']),
  ];
  const report = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 1 });
  assert.deepEqual(ranked(report, 'A.ts').map((c) => c.file), ['M.ts', 'Z.ts']);
});

// ── minGroupSize (tunable noise filter) ───────────────────────────────────

test('minGroupSize excludes commits with fewer changed files than the threshold from contributing evidence', () => {
  const history = [
    commit('pair', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts']),
    commit('triple', '2026-07-02T00:00:00Z', ['A.ts', 'B.ts', 'C.ts']),
  ];
  const report = computeCoChangeReport(['A.ts'], history, { minFrequency: 1, minGroupSize: 3 });
  const coChangers = ranked(report, 'A.ts');
  assert.equal(coChangers.find((c) => c.file === 'B.ts').count, 1, 'only the 3-file commit counts when minGroupSize is 3');
  assert.equal(coChangers.some((c) => c.file === 'C.ts'), true);
});

// ── defaults ───────────────────────────────────────────────────────────────

test('calling with no options object uses sensible defaults, never throws', () => {
  const history = [commit('c1', '2026-07-01T00:00:00Z', ['A.ts', 'B.ts'])];
  assert.doesNotThrow(() => computeCoChangeReport(['A.ts'], history));
});
