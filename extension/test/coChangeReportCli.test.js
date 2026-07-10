const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, formatCoChangeReport } = require('../out/tools/co-change-report');

// BL-255: parseArgs/formatCoChangeReport are pulled out of main() so
// they're exercised in-process (same "CLI main() run only via execFileSync
// is coverage-invisible" lesson recruiter-run.ts's/bakeoff-run.ts's own
// hardener passes already established) - the end-to-end subprocess test
// below proves the real git wiring separately.

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs collects positional file paths and returns default tunables', () => {
  const args = parseArgs(['extension/src/foo.ts', 'extension/src/bar.ts']);
  assert.deepEqual(args.changedFiles, ['extension/src/foo.ts', 'extension/src/bar.ts']);
  assert.equal(args.options.minFrequency, 3);
  assert.equal(args.options.minGroupSize, 2);
  assert.equal(args.options.windowCommits, undefined);
});

test('parseArgs reads --min-frequency/--min-group-size/--window flags, in any position', () => {
  const args = parseArgs(['--min-frequency=5', 'foo.ts', '--window=100', '--min-group-size=3']);
  assert.deepEqual(args.changedFiles, ['foo.ts']);
  assert.equal(args.options.minFrequency, 5);
  assert.equal(args.options.minGroupSize, 3);
  assert.equal(args.options.windowCommits, 100);
});

test('parseArgs returns null when no changed-file arguments are given', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['--min-frequency=5']), null);
});

// ── formatCoChangeReport (pure, deterministic) ────────────────────────────

function report(overrides = {}) {
  return [{ file: 'A.ts', coChangers: [{ file: 'B.ts', count: 5, coupled: true }, { file: 'C.ts', count: 1, coupled: false }], ...overrides }];
}

test('formatCoChangeReport flags a coupled co-changer distinctly from an uncoupled one', () => {
  const text = formatCoChangeReport(report());
  assert.match(text, /A\.ts/);
  assert.match(text, /B\.ts: 5 co-change\(s\) \(SUSPECTED COUPLING\)/);
  assert.match(text, /C\.ts: 1 co-change\(s\)$/m);
  assert.doesNotMatch(text, /C\.ts: 1 co-change\(s\) \(SUSPECTED/);
});

test('formatCoChangeReport shows an explicit "no co-changers" state rather than an empty section', () => {
  const text = formatCoChangeReport([{ file: 'Solo.ts', coChangers: [] }]);
  assert.match(text, /Solo\.ts/);
  assert.match(text, /no co-changers found/);
});

test('formatCoChangeReport is byte-identical across repeated calls on the same input (deterministic-ordering-05)', () => {
  const data = report();
  assert.equal(formatCoChangeReport(data), formatCoChangeReport(data));
});

// ── end-to-end: the compiled CLI runs against a REAL git repo ────────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-cochange-cli-'));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);
}

test('the compiled CLI reports real co-changers from a real git repo, ranked and flagged', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  commitFiles(root, { 'a.ts': '1', 'b.ts': '1' });
  commitFiles(root, { 'a.ts': '2', 'b.ts': '2' });
  commitFiles(root, { 'a.ts': '3', 'b.ts': '3' });
  commitFiles(root, { 'a.ts': '4', 'c.ts': '1' });

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'co-change-report.js');
  const output = execFileSync('node', [cliPath, '--min-frequency=3', 'a.ts'], { cwd: root, encoding: 'utf8' });

  assert.match(output, /a\.ts/);
  assert.match(output, /b\.ts: 3 co-change\(s\) \(SUSPECTED COUPLING\)/);
  assert.match(output, /c\.ts: 1 co-change\(s\)$/m);
});

test('the CLI exits non-zero with a usage message when no changed files are given', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'co-change-report.js');
  assert.throws(() => execFileSync('node', [cliPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
});
