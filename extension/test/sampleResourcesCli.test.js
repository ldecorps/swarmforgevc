const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { formatSampleResult, main } = require('../out/tools/sample-resources');
const { installFakeTmux } = require('./helpers/fakeTmux');

// ── formatSampleResult (pure) ────────────────────────────────────────────

test('formatSampleResult reports the sampled role count', () => {
  assert.equal(formatSampleResult(3), 'SAMPLED 3 role(s)');
});

test('formatSampleResult reports 0 roles sampled distinctly from a skip', () => {
  assert.equal(formatSampleResult(0), 'SAMPLED 0 role(s)');
});

test('formatSampleResult reports SKIPPED when null (already sampled this interval)', () => {
  assert.equal(formatSampleResult(null), 'SKIPPED already sampled this interval');
});

// ── the compiled CLI (BL-350) ─────────────────────────────────────────────

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-sample-resources-cli-')));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  return root;
}

function writeSessions(root, session = 'swarmforge-coder') {
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), '/tmp/fake.sock\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'sessions.tsv'), `1\tcoder\t${session}\tCoder\tclaude\n`);
}

const CLI = path.join(__dirname, '..', 'out', 'tools', 'sample-resources.js');

function telemetryPath(root) {
  const monthKey = new Date().toISOString().slice(0, 7);
  return path.join(root, '.swarmforge', 'telemetry', `chaser-${monthKey}.jsonl`);
}

function readTelemetryLines(root) {
  try {
    return fs
      .readFileSync(telemetryPath(root), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function runCliSubprocess(root) {
  return execFileSync('node', [CLI], { cwd: root, encoding: 'utf8' });
}

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see main()'s own branches (sample vs. skip) that a
// subprocess-only smoke test cannot (the engineering article's CLI
// main()-thin-wrapper rule / BL-233's CRAP trap). main() takes no
// parameters and reads no CLI args (cwd + the shared telemetry file drive
// it entirely), and prints via console.log - NOT process.stdout.write, so
// (per BL-350's own established seam, matching notifyDeadLettersCli.test.js's
// "call the real main() in-process with process.chdir + a captured
// console.log" pattern) this intercepts console.log directly rather than
// process.stdout.write, which Vitest does not route console output through.
function runCli(root) {
  const previousCwd = process.cwd();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    process.chdir(root);
    main();
  } finally {
    console.log = originalLog;
    process.chdir(previousCwd);
  }
  return logs.join('\n');
}

// BL-350 headless-resource-sampling-04: an existing, unrelated telemetry
// line (e.g. a chase event) must survive the CLI run untouched - the
// sampler ADDS a writer to the shared file, it never replaces it.
test('recording a resource sample leaves existing telemetry in the same file intact', () => {
  const root = initFixture();
  writeSessions(root);
  fs.mkdirSync(path.dirname(telemetryPath(root)), { recursive: true });
  fs.writeFileSync(telemetryPath(root), JSON.stringify({ type: 'chase', role: 'coder', at: new Date().toISOString() }) + '\n');

  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'display-message', exitCode: 0, stdout: `${child.pid}\n` },
  ]);
  try {
    runCli(root);
    const lines = readTelemetryLines(root);
    assert.equal(lines.length, 2);
    assert.ok(lines.some((l) => l.type === 'chase'));
    assert.ok(lines.some((l) => l.type === 'resource_sample'));
  } finally {
    fake.restore();
    child.kill();
  }
});

// BL-350 headless-resource-sampling-05: a sample already recorded moments
// ago (standing in for "an editor is attached and already sampling") means
// this sweep's own tick is due to skip - no second sample for the same
// interval.
test('the CLI skips sampling when a sample was already recorded within the interval', () => {
  const root = initFixture();
  writeSessions(root);
  fs.mkdirSync(path.dirname(telemetryPath(root)), { recursive: true });
  fs.writeFileSync(
    telemetryPath(root),
    JSON.stringify({ type: 'resource_sample', role: 'coder', rssBytes: 1, cpuPercent: 1, at: new Date().toISOString() }) + '\n'
  );

  const output = runCli(root);
  assert.match(output, /^SKIPPED /);

  const lines = readTelemetryLines(root);
  assert.equal(lines.length, 1, 'expected no additional resource_sample line to have been written');
});

test('main() records a resource sample in-process with no editor attached', () => {
  const root = initFixture();
  writeSessions(root);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'display-message', exitCode: 0, stdout: `${child.pid}\n` },
  ]);
  try {
    const output = runCli(root);
    assert.match(output, /^SAMPLED 1 role\(s\)/);

    const lines = readTelemetryLines(root);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, 'resource_sample');
    assert.equal(lines[0].role, 'coder');
  } finally {
    fake.restore();
    child.kill();
  }
});

test('main() skips sampling in-process when a sample was already recorded within the interval', () => {
  const root = initFixture();
  writeSessions(root);
  fs.mkdirSync(path.dirname(telemetryPath(root)), { recursive: true });
  fs.writeFileSync(
    telemetryPath(root),
    JSON.stringify({ type: 'resource_sample', role: 'coder', rssBytes: 1, cpuPercent: 1, at: new Date().toISOString() }) + '\n'
  );

  const output = runCli(root);
  assert.match(output, /^SKIPPED /);

  const lines = readTelemetryLines(root);
  assert.equal(lines.length, 1, 'expected no additional resource_sample line to have been written');
});

test('a missing .swarmforge/roles.tsv (no resolvable project root) exits non-zero rather than sampling nothing silently', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  assert.throws(() => runCli(root));
});

// BL-350 headless-resource-sampling-01: the compiled CLI, with a real
// disposable child process standing in for the tracked role's tmux pane
// (fake tmux resolves the pid, real `ps` reads its real rss/cpu - only the
// discovery hop is faked, per engineering.prompt's "never target the
// test's own pid" rule), records a resource_sample with no editor/VS Code
// host involved at all. A single subprocess smoke test locks the compiled
// CLI's own wiring (require.main === module, real argv/env boundary) - an
// ADDITION to the in-process tests above, never the only cover for the
// real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = initFixture();
  writeSessions(root);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  const fake = installFakeTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'display-message', exitCode: 0, stdout: `${child.pid}\n` },
  ]);
  try {
    const output = runCliSubprocess(root);
    assert.match(output, /^SAMPLED 1 role\(s\)/);

    const lines = readTelemetryLines(root);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, 'resource_sample');
    assert.equal(lines[0].role, 'coder');
    assert.ok(lines[0].rssBytes > 0);
  } finally {
    fake.restore();
    child.kill();
  }
});
