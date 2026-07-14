const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatNotDoneCountLine, main } = require('../out/tools/not-done-count-line');

// BL-263: the compiled not-done-count-line CLI is what briefing_email_lib.bb
// shells out to (Babashka cannot import compiled TS) - reuses
// computeBacklogDashboard's own notDoneCount field unchanged (the SAME
// field backlog.json/the PWA already carry), never a second "not done"
// derivation.

// ── formatNotDoneCountLine (pure) ─────────────────────────────────────────

test('formats a plural count', () => {
  assert.equal(formatNotDoneCountLine(3), 'Not done: 3 tickets');
});

test('formats a singular count without an "s"', () => {
  assert.equal(formatNotDoneCountLine(1), 'Not done: 1 ticket');
});

// BL-263 zero-state-03
test('formats zero explicitly, not a blank line', () => {
  assert.equal(formatNotDoneCountLine(0), 'Not done: 0 tickets');
});

// ── end-to-end: the compiled CLI runs against a REAL git repo ────────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-not-done-count-cli-'));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(root) {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'not-done-count-line.js');

// Runs the REAL main() in-process against a real fixture repo, so
// in-process coverage and mutation tooling can see the logic a
// subprocess-only smoke test cannot (the engineering article's CLI
// main()-thin-wrapper rule). main() takes no arguments - it reads
// process.cwd() directly - so this only needs to move + restore cwd, never
// process.argv. main() prints via console.log (not process.stdout.write
// directly) and Vitest intercepts console.* separately from
// process.stdout.write - mocking stdout.write here would silently capture
// nothing, so console.log itself is mocked instead. The `finally` restore
// is non-negotiable: Vitest runs every test file in one worker process, so
// a test that leaves the cwd moved (or console.log unmocked) silently
// corrupts every test that runs after it.
async function runCli(root) {
  const previousCwd = process.cwd();
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => {
    writes.push(args.join(' '));
  };
  try {
    process.chdir(root);
    await main();
  } finally {
    console.log = originalLog;
    process.chdir(previousCwd);
  }
  return writes.join('\n');
}

function runCliSubprocess(root) {
  return execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8' });
}

test('the compiled CLI reports zero when every ticket is done', async () => {
  const root = mkTmp();
  initRepo(root);
  writeRolesTsv(root);
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'done', 'BL-100.yaml'), 'id: BL-100\ntitle: Done one\nstatus: done\n');
  commitAll(root, 'all-done backlog');

  const output = await runCli(root);

  assert.equal(output.trim(), 'Not done: 0 tickets');
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result (active + paused, excluding done)', () => {
  const root = mkTmp();
  initRepo(root);
  writeRolesTsv(root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-100.yaml'), 'id: BL-100\ntitle: Active one\nstatus: active\n');
  fs.writeFileSync(path.join(root, 'backlog', 'paused', 'BL-101.yaml'), 'id: BL-101\ntitle: Paused one\nstatus: paused\n');
  fs.writeFileSync(path.join(root, 'backlog', 'done', 'BL-102.yaml'), 'id: BL-102\ntitle: Done one\nstatus: done\n');
  commitAll(root, 'seed backlog');

  const output = runCliSubprocess(root);

  assert.equal(output.trim(), 'Not done: 2 tickets');
});
