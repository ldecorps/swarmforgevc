const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  formatReworkSignal,
  runObservatory,
  main,
  WINDOW_DAYS,
  BASELINE_WINDOW_DAYS,
} = require('../out/tools/rework-observatory');
const { observatorySignalsPath } = require('../out/metrics/reworkObservatoryStore');

function mkTmp() {
  return mkTmpDir('sfvc-rework-cli-');
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args, dateIso) {
  const env = { ...process.env };
  if (dateIso) {
    env.GIT_AUTHOR_DATE = dateIso;
    env.GIT_COMMITTER_DATE = dateIso;
  }
  execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepoOnMain(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['checkout', '-q', '-b', 'main']);
}

// ── formatReworkSignal (pure) ────────────────────────────────────────────

test('formatReworkSignal reports NO_SAMPLE plainly when there is no sample', () => {
  const line = formatReworkSignal({ hasSample: false, sampleCount: 0, reworkRate: null, baselineRate: null, topRole: null, topTicketClass: null }, 14);
  assert.match(line, /no sample/i);
});

test('formatReworkSignal reports the rate, baseline, sample count, and concentration', () => {
  const line = formatReworkSignal(
    { hasSample: true, sampleCount: 4, reworkRate: 0.25, baselineRate: 0.5, topRole: 'architect', topTicketClass: 'high' },
    14
  );
  assert.match(line, /25%/);
  assert.match(line, /50%/);
  assert.match(line, /n=4/);
  assert.match(line, /architect/);
  assert.match(line, /high/);
});

test('formatReworkSignal with a null baseline shows a no-sample marker there too, never a fabricated number', () => {
  const line = formatReworkSignal(
    { hasSample: true, sampleCount: 2, reworkRate: 0, baselineRate: null, topRole: null, topTicketClass: null },
    14
  );
  assert.match(line, /baseline —/);
});

// ── runObservatory (real git fixture) ────────────────────────────────────

test('runObservatory computes the signal, persists it, and returns a matching summary line', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);

  // Fixture dates are derived from nowMs, never hardcoded - a literal past
  // date drifts out of the 14-day trailing window as real time passes
  // (engineering rule: never seed a fixture from an assumption about "now"
  // independent of the instant the code under test is actually given).
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const promotedAtIso = new Date(nowMs - 3 * DAY_MS).toISOString();
  const closedAtIso = new Date(nowMs - 2 * DAY_MS).toISOString();

  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-1.yaml'), 'id: BL-1\nmutation_cost: low\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote'], promotedAtIso);
  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-1.yaml', 'backlog/done/BL-1.yaml']);
  git(repo, ['commit', '-q', '-m', 'close'], closedAtIso);

  const result = runObservatory(repo, [], nowMs);

  assert.equal(result.signal.hasSample, true);
  assert.equal(result.signal.reworkRate, 0);
  assert.equal(result.summaryLine, formatReworkSignal(result.signal, WINDOW_DAYS));

  const persisted = JSON.parse(fs.readFileSync(observatorySignalsPath(repo), 'utf8'));
  const reworkEntry = persisted.signals.find((s) => s.kind === 'rework-rate');
  assert.ok(reworkEntry);
  assert.equal(reworkEntry.windowDays, WINDOW_DAYS);
  assert.equal(reworkEntry.baselineWindowDays, BASELINE_WINDOW_DAYS);
  assert.deepEqual(reworkEntry.signal, result.signal);
});

test('runObservatory reports no sample when nothing closed within the trailing window', () => {
  const repo = mkTmp();
  initRepoOnMain(repo);
  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-2.yaml'), 'id: BL-2\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote, never closed'], '2026-07-01T08:00:00');

  const result = runObservatory(repo, [], Date.now());
  assert.equal(result.signal.hasSample, false);
});

// ── main() - real git fixture, in-process (thin-wrapper rule) ──────────────

function mkCliFixture() {
  const repo = mkTmp();
  initRepoOnMain(repo);
  mkdirp(path.join(repo, 'backlog', 'active'));
  fs.writeFileSync(path.join(repo, 'backlog', 'active', 'BL-9.yaml'), 'id: BL-9\nmutation_cost: medium\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'promote'], '2026-07-01T08:00:00');
  mkdirp(path.join(repo, 'backlog', 'done'));
  git(repo, ['mv', 'backlog/active/BL-9.yaml', 'backlog/done/BL-9.yaml']);
  git(repo, ['commit', '-q', '-m', 'close'], '2026-07-01T09:00:00');

  mkdirp(path.join(repo, '.swarmforge'));
  fs.writeFileSync(path.join(repo, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${repo}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);
  return repo;
}

async function runCli(root) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const writes = [];
  const originalLog = console.log;
  console.log = (chunk) => {
    writes.push(chunk);
  };
  try {
    process.argv = ['node', 'rework-observatory.js'];
    process.cwd = () => root;
    await main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
    process.argv = previousArgv;
  }
  return writes.join('\n');
}

test('main() prints a summary line and persists the signal file against a real fixture', async () => {
  const repo = mkCliFixture();
  const output = await runCli(repo);
  assert.match(output, /Rework rate/);
  assert.equal(fs.existsSync(observatorySignalsPath(repo)), true);
});
