const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  assertRecordPassed,
  assertTestCountNotShrunk,
  buildDurationProfile,
  formatDurationProfileMarkdown,
  parseArgs,
  runBuildProfile,
  main,
  OPERATIONAL_CEILING_MS,
} = require('../out/tools/build-test-duration-profile');

// ── assertRecordPassed - BL-792 invariant "never a failing run as baseline" ─

test('assertRecordPassed does not throw for a passing record', () => {
  assert.doesNotThrow(() => assertRecordPassed({ finished_at: 'x', test_count: 1, result: 'pass', duration_ms: 1 }));
});

test('assertRecordPassed throws for a failing record', () => {
  assert.throws(() => assertRecordPassed({ finished_at: 'x', test_count: 1, result: 'fail', duration_ms: 1 }), /non-passing/);
});

// ── assertTestCountNotShrunk - BL-792 invariant "test_count never falls" ────

test('assertTestCountNotShrunk does not throw with no previous record', () => {
  assert.doesNotThrow(() => assertTestCountNotShrunk(undefined, { finished_at: 'x', test_count: 5, result: 'pass', duration_ms: 1 }));
});

test('assertTestCountNotShrunk does not throw when the count is unchanged or grew', () => {
  const previous = { finished_at: 'x', test_count: 5, result: 'pass', duration_ms: 1 };
  assert.doesNotThrow(() => assertTestCountNotShrunk(previous, { ...previous, test_count: 5 }));
  assert.doesNotThrow(() => assertTestCountNotShrunk(previous, { ...previous, test_count: 6 }));
});

test('assertTestCountNotShrunk throws when the count fell', () => {
  const previous = { finished_at: 'x', test_count: 5, result: 'pass', duration_ms: 1 };
  assert.throws(() => assertTestCountNotShrunk(previous, { ...previous, test_count: 4 }), /fell from 5 to 4/);
});

// ── buildDurationProfile (pure) ──────────────────────────────────────────

test('buildDurationProfile sorts entries slowest first', () => {
  const profile = buildDurationProfile([
    { file: 'a', durationMs: 10 },
    { file: 'b', durationMs: 100 },
    { file: 'c', durationMs: 50 },
  ]);
  assert.deepEqual(
    profile.entries.map((e) => e.file),
    ['b', 'c', 'a']
  );
  assert.equal(profile.totalMs, 160);
});

test('buildDurationProfile names poles as the smallest slowest-first prefix reaching the bulk fraction', () => {
  // total = 100; default bulk fraction 0.5 -> target 50; first file (60) alone already clears it
  const profile = buildDurationProfile([
    { file: 'small', durationMs: 40 },
    { file: 'big', durationMs: 60 },
  ]);
  assert.deepEqual(
    profile.poles.map((p) => p.file),
    ['big']
  );
});

test('buildDurationProfile requires more than one file when no single file reaches the bulk fraction alone', () => {
  const profile = buildDurationProfile([
    { file: 'a', durationMs: 34 },
    { file: 'b', durationMs: 33 },
    { file: 'c', durationMs: 33 },
  ]);
  // target = 100*0.5 = 50; 'a' alone (34) is under it, 'a'+'b' (67) clears it
  assert.deepEqual(
    profile.poles.map((p) => p.file),
    ['a', 'b']
  );
});

test('buildDurationProfile with an empty input reports zero total and no poles', () => {
  const profile = buildDurationProfile([]);
  assert.equal(profile.totalMs, 0);
  assert.deepEqual(profile.entries, []);
  assert.deepEqual(profile.poles, []);
});

// ── formatDurationProfileMarkdown ────────────────────────────────────────

const PASSING_RECORD = { finished_at: '2026-08-03T09:47:04.908Z', test_count: 438, result: 'pass', duration_ms: 326510 };

test('formatDurationProfileMarkdown lists every entry with its own duration, slowest first', () => {
  const profile = buildDurationProfile([
    { file: '/repo/test/a.test.js', durationMs: 10 },
    { file: '/repo/test/b.test.js', durationMs: 200 },
  ]);
  const text = formatDurationProfileMarkdown(PASSING_RECORD, profile, '/repo');
  const bIndex = text.indexOf('test/b.test.js');
  const aIndex = text.indexOf('test/a.test.js');
  assert.ok(bIndex >= 0 && aIndex >= 0);
  assert.ok(bIndex < aIndex, 'expected the slower file (b) to be listed before the faster one (a)');
  assert.match(text, /\| test\/b\.test\.js \| 200 \|/);
  assert.match(text, /\| test\/a\.test\.js \| 10 \|/);
});

test('formatDurationProfileMarkdown names poles only when the run is over the 13s operational ceiling', () => {
  const smallProfile = buildDurationProfile([{ file: '/repo/test/a.test.js', durationMs: 10 }]);
  const underCeiling = { ...PASSING_RECORD, duration_ms: OPERATIONAL_CEILING_MS - 1 };
  const underText = formatDurationProfileMarkdown(underCeiling, smallProfile, '/repo');
  assert.doesNotMatch(underText, /Poles slice B must cut/);

  const overCeiling = { ...PASSING_RECORD, duration_ms: OPERATIONAL_CEILING_MS + 1 };
  const overText = formatDurationProfileMarkdown(overCeiling, smallProfile, '/repo');
  assert.match(overText, /Poles slice B must cut/);
});

test('formatDurationProfileMarkdown records the run result and wall-clock duration', () => {
  const profile = buildDurationProfile([{ file: '/repo/test/a.test.js', durationMs: 10 }]);
  const text = formatDurationProfileMarkdown(PASSING_RECORD, profile, '/repo');
  assert.match(text, /result \*\*pass\*\*/);
  assert.match(text, /438 test files/);
  assert.match(text, /326\.5s wall-clock/);
});

// ── parseArgs (BL-233 CLI thin-wrapper split) ────────────────────────────

test('parseArgs returns the three positional paths when all are given', () => {
  assert.deepEqual(parseArgs(['report.json', 'durations.jsonl', 'out.md']), {
    reportPath: 'report.json',
    durationsJsonlPath: 'durations.jsonl',
    outputPath: 'out.md',
  });
});

test('parseArgs returns null when any positional arg is missing', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['report.json']), null);
  assert.equal(parseArgs(['report.json', 'durations.jsonl']), null);
});

// ── runBuildProfile (the real orchestration, in-process) ────────────────

function writeVitestReport(reportPath, entries) {
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      testResults: entries.map((e) => ({ name: e.file, startTime: 0, endTime: e.durationMs })),
    })
  );
}

function writeDurationsJsonl(durationsPath, records) {
  fs.writeFileSync(durationsPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

test('runBuildProfile writes a profile document from a real passing record and report', () => {
  const dir = mkTmpDir('sfvc-build-test-duration-profile-');
  const reportPath = path.join(dir, 'report.json');
  const durationsPath = path.join(dir, 'durations.jsonl');
  const outputPath = path.join(dir, 'profile.md');
  writeVitestReport(reportPath, [
    { file: path.join(dir, 'test/a.test.js'), durationMs: 10 },
    { file: path.join(dir, 'test/b.test.js'), durationMs: 200 },
  ]);
  writeDurationsJsonl(durationsPath, [{ finished_at: 'x', test_count: 2, result: 'pass', duration_ms: 210 }]);

  runBuildProfile({ reportPath, durationsJsonlPath: durationsPath, outputPath });

  const written = fs.readFileSync(outputPath, 'utf8');
  const bIndex = written.indexOf('test/b.test.js');
  const aIndex = written.indexOf('test/a.test.js');
  assert.ok(bIndex >= 0 && aIndex >= 0 && bIndex < aIndex);
});

test('runBuildProfile refuses to build a profile from a failing latest record', () => {
  const dir = mkTmpDir('sfvc-build-test-duration-profile-');
  const reportPath = path.join(dir, 'report.json');
  const durationsPath = path.join(dir, 'durations.jsonl');
  const outputPath = path.join(dir, 'profile.md');
  writeVitestReport(reportPath, [{ file: path.join(dir, 'test/a.test.js'), durationMs: 10 }]);
  writeDurationsJsonl(durationsPath, [{ finished_at: 'x', test_count: 1, result: 'fail', duration_ms: 10 }]);

  assert.throws(() => runBuildProfile({ reportPath, durationsJsonlPath: durationsPath, outputPath }), /non-passing/);
  assert.equal(fs.existsSync(outputPath), false);
});

test('runBuildProfile refuses when the latest record shrank the test count from the previous one', () => {
  const dir = mkTmpDir('sfvc-build-test-duration-profile-');
  const reportPath = path.join(dir, 'report.json');
  const durationsPath = path.join(dir, 'durations.jsonl');
  const outputPath = path.join(dir, 'profile.md');
  writeVitestReport(reportPath, [{ file: path.join(dir, 'test/a.test.js'), durationMs: 10 }]);
  writeDurationsJsonl(durationsPath, [
    { finished_at: 'x', test_count: 5, result: 'pass', duration_ms: 10 },
    { finished_at: 'y', test_count: 4, result: 'pass', duration_ms: 10 },
  ]);

  assert.throws(() => runBuildProfile({ reportPath, durationsJsonlPath: durationsPath, outputPath }), /fell from 5 to 4/);
  assert.equal(fs.existsSync(outputPath), false);
});

// ── main() - runs in-process against real files (CLI thin-wrapper rule) ──
//
// Stubs process.argv/console.log/process.exitCode the same way this
// codebase's other CLI tests do (see coChangeReportCli.test.js's runCli),
// so main()'s own dispatch (usage-on-missing-args vs. delegate to
// runBuildProfile) is exercised in-process rather than left coverage-
// invisible behind a subprocess-only smoke test.
async function runMain(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const previousWrite = process.stderr.write;
  const stderrWrites = [];
  process.stderr.write = (chunk) => {
    stderrWrites.push(chunk.toString());
    return true;
  };
  process.exitCode = undefined;
  try {
    process.argv = ['node', 'build-test-duration-profile.js', ...args];
    await main();
    return { stderr: stderrWrites.join(''), exitCode: process.exitCode };
  } finally {
    process.stderr.write = previousWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main writes the profile document when given real paths', async () => {
  const dir = mkTmpDir('sfvc-build-test-duration-profile-main-');
  const reportPath = path.join(dir, 'report.json');
  const durationsPath = path.join(dir, 'durations.jsonl');
  const outputPath = path.join(dir, 'profile.md');
  writeVitestReport(reportPath, [{ file: path.join(dir, 'test/a.test.js'), durationMs: 10 }]);
  writeDurationsJsonl(durationsPath, [{ finished_at: 'x', test_count: 1, result: 'pass', duration_ms: 10 }]);

  const { exitCode } = await runMain([reportPath, durationsPath, outputPath]);

  assert.equal(exitCode, undefined);
  assert.match(fs.readFileSync(outputPath, 'utf8'), /test\/a\.test\.js/);
});

test('main prints usage and exits 1 when a required arg is missing', async () => {
  const { stderr, exitCode } = await runMain(['report.json']);
  assert.match(stderr, /^Usage: node build-test-duration-profile\.js/);
  assert.equal(exitCode, 1);
});
