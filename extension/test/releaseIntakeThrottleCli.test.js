'use strict';

// BL-1981: drives the REAL compiled release-intake-throttle.js directly -
// never a restatement of its argument-parsing or episode-answering logic.
const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, recordThrottleRelease, main } = require('../out/tools/release-intake-throttle');
const { emitThrottleRecommendation, throttleRecommendationPath, throttleChangeLogPath } = require('../out/tools/emit-throttle-recommendation');
const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');

function mkTmp() {
  return mkTmpDir('sfvc-release-intake-throttle-');
}

function writeSignal(targetPath, overrides) {
  persistReworkSignal(targetPath, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-10-05T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.5, baselineRate: 0.1, topRole: null, topTicketClass: null, ...overrides },
  });
}

function readChangeLogLines(targetPath) {
  try {
    return fs
      .readFileSync(throttleChangeLogPath(targetPath), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function openEpisode(targetPath) {
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 }); // degraded -> cap 1
  return emitThrottleRecommendation(targetPath, Date.parse('2026-10-05T00:00:00Z'));
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs parses a release', () => {
  assert.deepEqual(parseArgs(['/target', '--by', 'human', '--release']), {
    targetRepoPath: '/target',
    by: 'human',
    answer: { kind: 'release' },
    reason: undefined,
  });
});

test('parseArgs parses a keep with its value', () => {
  assert.deepEqual(parseArgs(['/target', '--by', 'human', '--keep', '3']), {
    targetRepoPath: '/target',
    by: 'human',
    answer: { kind: 'keep', value: 3 },
    reason: undefined,
  });
});

test('parseArgs carries an optional --reason', () => {
  const args = parseArgs(['/target', '--by', 'human', '--release', '--reason', 'looks stable']);
  assert.equal(args.reason, 'looks stable');
});

test('parseArgs returns null with no target repo path', () => {
  assert.equal(parseArgs([]), null);
});

test('parseArgs returns null with no --by', () => {
  assert.equal(parseArgs(['/target', '--release']), null);
});

test('parseArgs returns null when neither --release nor --keep is given', () => {
  assert.equal(parseArgs(['/target', '--by', 'human']), null);
});

test('parseArgs returns null when --release and --keep are both given (mutually exclusive)', () => {
  assert.equal(parseArgs(['/target', '--by', 'human', '--release', '--keep', '3']), null);
});

// BL-1981 hardening: a scoped Stryker run found two real validation gaps
// in parseArgs - both silently accept invalid input rather than refuse it.
test('parseArgs rejects an empty-string target repo path (never confused with "no --by", the existing test\'s own coincidental reason for returning null)', () => {
  // The existing "no target repo path" test uses argv=[], which also
  // leaves --by unset - that test can pass whether or not the
  // !targetRepoPath check itself ever runs, because the LATER !by check
  // rejects it anyway. This fixture keeps --by/--release present so only
  // the targetRepoPath check itself can produce the null.
  assert.equal(parseArgs(['', '--by', 'human', '--release']), null);
});

test('parseArgs rejects a --keep value that does not parse as a finite number (e.g. a non-numeric token)', () => {
  assert.equal(parseArgs(['/target', '--by', 'human', '--keep', 'not-a-number']), null);
});

// ── recordThrottleRelease ──────────────────────────────────────────────

test('recordThrottleRelease refuses when no episode is open', () => {
  const targetPath = mkTmp();
  assert.throws(() => recordThrottleRelease({ targetRepoPath: targetPath, by: 'human', answer: { kind: 'release' } }), /no open throttle episode/);
});

test('recordThrottleRelease records a release onto the open episode and lifts the hold', () => {
  const targetPath = mkTmp();
  openEpisode(targetPath);
  const updated = recordThrottleRelease({ targetRepoPath: targetPath, by: 'human', answer: { kind: 'release' } }, Date.parse('2026-10-05T00:01:00Z'));
  assert.equal(updated.episode.answer.kind, 'release');
  assert.equal(updated.episode.answer.by, 'human');
  assert.equal(updated.heldCap, null, 'a release lifts the hold floor - the live signal alone governs now');
});

test('recordThrottleRelease records a keep onto the open episode and holds at the given value', () => {
  const targetPath = mkTmp();
  openEpisode(targetPath);
  const updated = recordThrottleRelease({ targetRepoPath: targetPath, by: 'human', answer: { kind: 'keep', value: 3 } }, Date.parse('2026-10-05T00:01:00Z'));
  assert.equal(updated.episode.answer.kind, 'keep');
  assert.equal(updated.episode.answer.value, 3);
  assert.equal(updated.heldCap, 3);
});

test('recordThrottleRelease persists the answer to disk', () => {
  const targetPath = mkTmp();
  openEpisode(targetPath);
  recordThrottleRelease({ targetRepoPath: targetPath, by: 'human', answer: { kind: 'release' } }, Date.parse('2026-10-05T00:01:00Z'));
  const onDisk = JSON.parse(fs.readFileSync(throttleRecommendationPath(targetPath), 'utf8'));
  assert.equal(onDisk.episode.answer.kind, 'release');
});

test('recordThrottleRelease logs the release, naming who gave it', () => {
  const targetPath = mkTmp();
  openEpisode(targetPath);
  recordThrottleRelease({ targetRepoPath: targetPath, by: 'human', answer: { kind: 'release' } }, Date.parse('2026-10-05T00:01:00Z'));
  const last = readChangeLogLines(targetPath).at(-1);
  assert.match(last.reason, /release recorded by "human"/);
});

test('recordThrottleRelease logs the keep value, naming who gave it', () => {
  const targetPath = mkTmp();
  openEpisode(targetPath);
  recordThrottleRelease({ targetRepoPath: targetPath, by: 'human', answer: { kind: 'keep', value: 3 } }, Date.parse('2026-10-05T00:01:00Z'));
  const last = readChangeLogLines(targetPath).at(-1);
  assert.match(last.reason, /keep at 3 recorded by "human"/);
});

// ── main() wiring ──────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'release-intake-throttle.js');

async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, output: writes.join('') };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() prints usage and exits non-zero when required args are missing', async () => {
  const result = await runCli([]);
  assert.notEqual(result.exitCode, 0);
});

test('main() records the release and prints the updated recommendation as JSON', async () => {
  const targetPath = mkTmp();
  openEpisode(targetPath);
  const { exitCode, output } = await runCli([targetPath, '--by', 'human', '--release']);
  assert.equal(exitCode, 0);
  const printed = JSON.parse(output);
  assert.equal(printed.episode.answer.kind, 'release');
});

// main() itself only guards missing/malformed ARGS; the "no open episode"
// refusal throws from recordThrottleRelease, which runCliMain's own
// process.exit(1) handles - the real subprocess boundary, so the
// refusal's actual exit code is observed rather than this harness's own
// process exiting.
test('main() exits non-zero with a fatal message when no episode is open to answer', () => {
  const targetPath = mkTmp();
  assert.throws(() => execFileSync('node', [CLI_PATH, targetPath, '--by', 'human', '--release'], { encoding: 'utf8' }));
});

test('the compiled CLI runs standalone as a subprocess and records a release', () => {
  const targetPath = mkTmp();
  openEpisode(targetPath);
  const output = execFileSync('node', [CLI_PATH, targetPath, '--by', 'human', '--release'], { encoding: 'utf8' });
  const printed = JSON.parse(output);
  assert.equal(printed.episode.answer.kind, 'release');
  assert.equal(printed.episode.answer.by, 'human');
});
