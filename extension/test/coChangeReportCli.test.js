const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, formatCoChangeReport, toRepoRelativePath } = require('../out/tools/co-change-report');

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

// ── toRepoRelativePath (pure, BL-268) ─────────────────────────────────────

test('an arg already repo-root-relative, run from the repo root, is unchanged', () => {
  assert.equal(toRepoRelativePath('/repo', '/repo', 'extension/src/foo.ts'), 'extension/src/foo.ts');
});

test('an arg relative to a subdirectory cwd resolves to its repo-relative path', () => {
  assert.equal(toRepoRelativePath('/repo/extension', '/repo', 'src/foo.ts'), 'extension/src/foo.ts');
});

test('an absolute path resolves to its repo-relative path regardless of cwd', () => {
  assert.equal(toRepoRelativePath('/repo/extension', '/repo', '/repo/pwa/app.js'), 'pwa/app.js');
});

test('uses forward slashes in the result (matching git log --name-status path format)', () => {
  const result = toRepoRelativePath('/repo/extension', '/repo', 'src/foo.ts');
  assert.doesNotMatch(result, /\\/);
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

// ── BL-268: cross-directory co-changers must not depend on invoker cwd ──
// A green run from the repo ROOT is not proof - the whole bug was that
// results silently differed by cwd, so every test below runs from a
// SUBDIRECTORY and compares against the same query from the root.

function mkCrossDirRepo() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  // Three commits touch dirA/target.ts alongside a file in a DIFFERENT
  // top-level directory (dirB/) - cross-directory co-change, the exact
  // shape BL-268 found silently dropped when scoped to dirA/'s subtree.
  commitFiles(root, { 'dirA/target.ts': '1', 'dirB/other.ts': '1' });
  commitFiles(root, { 'dirA/target.ts': '2', 'dirB/other.ts': '2' });
  commitFiles(root, { 'dirA/target.ts': '3', 'dirB/other.ts': '3' });
  return root;
}

// BL-268 co-change-cwd-independence-01
test('cross-directory co-changers are reported identically whether run from the repo root or a subdirectory', () => {
  const root = mkCrossDirRepo();
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'co-change-report.js');

  const fromRoot = execFileSync('node', [cliPath, '--min-frequency=3', 'dirA/target.ts'], { cwd: root, encoding: 'utf8' });
  // Addressed cwd-relative ("target.ts" from inside dirA/) - the same file
  // as "dirA/target.ts" from the root, per toRepoRelativePath's own
  // documented cwd-relative contract.
  const fromSubdir = execFileSync('node', [cliPath, '--min-frequency=3', 'target.ts'], {
    cwd: path.join(root, 'dirA'),
    encoding: 'utf8',
  });

  assert.match(fromSubdir, /dirB\/other\.ts: 3 co-change\(s\) \(SUSPECTED COUPLING\)/);
  assert.equal(fromSubdir, fromRoot);
});

// BL-268 co-change-cwd-independence-02
test('a changed-file argument written relative to a subdirectory resolves to its repo-relative history path', () => {
  const root = mkCrossDirRepo();
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'co-change-report.js');

  // Run from dirA/, address the target file relative to THAT directory
  // (just "target.ts") rather than the repo-relative "dirA/target.ts".
  const output = execFileSync('node', [cliPath, '--min-frequency=3', 'target.ts'], {
    cwd: path.join(root, 'dirA'),
    encoding: 'utf8',
  });

  assert.match(output, /^dirA\/target\.ts:/m);
  assert.match(output, /dirB\/other\.ts: 3 co-change\(s\) \(SUSPECTED COUPLING\)/);
});

test('the CLI exits non-zero with a usage message when no changed files are given', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'co-change-report.js');
  assert.throws(() => execFileSync('node', [cliPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
});
