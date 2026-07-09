const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatStageDwellReport, parseArgs } = require('../out/tools/stage-dwell-report');

// BL-102 dwell-05: the presenter for computeStageDwellReportForRoles -
// resolveProjectRoot/roles.tsv wiring is exercised by swarm-metrics.ts's own
// tests (same helpers, reused here); this file covers the pure formatting
// this tool adds, plus one end-to-end run of the compiled CLI (--json and
// plain-text) matching swarmMetricsCli.test.js's own "compiled CLI" test.

function emptyStats() {
  return { medianMs: null, p90Ms: null, maxMs: null, outliersMs: [] };
}

function unknownTrend() {
  return { series: [], currentValue: null, priorValue: null, delta: null, direction: 'unknown' };
}

test('formatStageDwellReport on an empty roster prints the window header and a no-bottleneck line', () => {
  const text = formatStageDwellReport({
    windowHours: 24,
    windowStartIso: '2026-07-08T00:00:00.000Z',
    windowEndIso: '2026-07-09T00:00:00.000Z',
    stages: [],
    bottleneck: null,
    unparseableCount: 0,
  });
  assert.match(text, /Stage dwell \(24h window/);
  assert.match(text, /Bottleneck: \(no stage processed a parcel this window\)/);
  assert.doesNotMatch(text, /NaN|undefined/);
});

test('formatStageDwellReport reports parcel count, wait/processing stats, and outlier counts per stage', () => {
  const text = formatStageDwellReport({
    windowHours: 24,
    windowStartIso: '2026-07-08T00:00:00.000Z',
    windowEndIso: '2026-07-09T00:00:00.000Z',
    stages: [
      {
        role: 'coder',
        parcelsProcessed: 3,
        queueWait: { medianMs: 60000, p90Ms: 90000, maxMs: 120000, outliersMs: [] },
        processing: { medianMs: 300000, p90Ms: 400000, maxMs: 500000, outliersMs: [61200000] },
        trend: unknownTrend(),
      },
    ],
    bottleneck: { role: 'coder', totalDwellMs: 360000, multipleOverNext: null },
    unparseableCount: 0,
  });
  assert.match(text, /coder: 3 parcel\(s\)/);
  assert.match(text, /wait median 1m/);
  assert.match(text, /processing median 5m/);
  assert.match(text, /\(\+1 outlier\(s\)\)/);
  assert.match(text, /Bottleneck: coder/);
});

test('formatStageDwellReport states the bottleneck stage\'s multiple over the next slowest', () => {
  const text = formatStageDwellReport({
    windowHours: 24,
    windowStartIso: 'a',
    windowEndIso: 'b',
    stages: [],
    bottleneck: { role: 'cleaner', totalDwellMs: 1000, multipleOverNext: 3.333 },
    unparseableCount: 0,
  });
  assert.match(text, /Bottleneck: cleaner \(3\.3x the next slowest stage\)/);
});

test('formatStageDwellReport reports an up/down trend suffix per stage, matching formatTrend\'s sign convention', () => {
  const text = formatStageDwellReport({
    windowHours: 24,
    windowStartIso: 'a',
    windowEndIso: 'b',
    stages: [
      {
        role: 'coder',
        parcelsProcessed: 1,
        queueWait: emptyStats(),
        processing: { ...emptyStats(), medianMs: 60000 },
        trend: { series: [], currentValue: 120000, priorValue: 60000, delta: 60000, direction: 'up' },
      },
    ],
    bottleneck: null,
    unparseableCount: 0,
  });
  assert.match(text, /\(\+1m vs prior\)/);
});

test('formatStageDwellReport appends the unparseable-count note only when there is at least one', () => {
  const withNote = formatStageDwellReport({
    windowHours: 24,
    windowStartIso: 'a',
    windowEndIso: 'b',
    stages: [],
    bottleneck: null,
    unparseableCount: 2,
  });
  assert.match(withNote, /2 handoff header\(s\) could not be parsed/);

  const withoutNote = formatStageDwellReport({
    windowHours: 24,
    windowStartIso: 'a',
    windowEndIso: 'b',
    stages: [],
    bottleneck: null,
    unparseableCount: 0,
  });
  assert.doesNotMatch(withoutNote, /could not be parsed/);
});

// ── parseArgs (pure, in-process so it's actually coverage-instrumented -
//    the end-to-end CLI tests below run a separate `node` process, which v8
//    coverage cannot see into) ─────────────────────────────────────────────

test('parseArgs defaults to the standard window and plain-text output with no flags', () => {
  const args = parseArgs([]);
  assert.equal(args.json, false);
  assert.equal(args.hours, 24);
});

test('parseArgs sets json true on --json', () => {
  const args = parseArgs(['--json']);
  assert.equal(args.json, true);
});

test('parseArgs honors a valid --hours value', () => {
  const args = parseArgs(['--hours', '6']);
  assert.equal(args.hours, 6);
});

test('parseArgs ignores a non-numeric --hours value and keeps the default', () => {
  const args = parseArgs(['--hours', 'not-a-number']);
  assert.equal(args.hours, 24);
});

test('parseArgs ignores a non-positive --hours value and keeps the default', () => {
  const args = parseArgs(['--hours', '0']);
  assert.equal(args.hours, 24);
});

test('parseArgs ignores a trailing --hours with no value and keeps the default', () => {
  const args = parseArgs(['--hours']);
  assert.equal(args.hours, 24);
});

test('parseArgs combines --json and --hours regardless of order', () => {
  const args = parseArgs(['--hours', '3', '--json']);
  assert.equal(args.json, true);
  assert.equal(args.hours, 3);
});

// ── end-to-end: the compiled CLI, plain-text and --json (dwell-05) ──────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-stage-dwell-cli-'));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function makeFixtureRoot() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  mkdirp(path.join(root, 'backlog', 'active'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const completedDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'completed');
  mkdirp(completedDir);
  const now = new Date();
  const dequeuedAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  fs.writeFileSync(
    path.join(completedDir, '00_test.handoff'),
    `task: BL-1-fixture\ndequeued_at: ${dequeuedAt}\ncompleted_at: ${now.toISOString()}\n\nbody\n`
  );
  return root;
}

test('the compiled stage-dwell-report CLI runs from a worktree and prints a plain-text report', () => {
  const root = makeFixtureRoot();
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'stage-dwell-report.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.match(output, /Stage dwell \(24h window/);
  assert.match(output, /coder: 1 parcel\(s\)/);
  assert.doesNotMatch(output, /NaN|Infinity|undefined/);
});

test('the compiled stage-dwell-report CLI emits the same figures as structured JSON with --json (dwell-05)', () => {
  const root = makeFixtureRoot();
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'stage-dwell-report.js');
  const output = execFileSync('node', [cliPath, '--json'], { cwd: root, encoding: 'utf8' });

  const parsed = JSON.parse(output);
  assert.equal(parsed.windowHours, 24);
  const coderStage = parsed.stages.find((s) => s.role === 'coder');
  assert.ok(coderStage, 'expected a coder stage in the JSON output');
  assert.equal(coderStage.parcelsProcessed, 1);
  assert.equal(coderStage.processing.medianMs, 10 * 60 * 1000);
});

test('the compiled stage-dwell-report CLI honors --hours to narrow the window', () => {
  const root = makeFixtureRoot();
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'stage-dwell-report.js');
  const output = execFileSync('node', [cliPath, '--hours', '1', '--json'], { cwd: root, encoding: 'utf8' });

  const parsed = JSON.parse(output);
  assert.equal(parsed.windowHours, 1);
});
