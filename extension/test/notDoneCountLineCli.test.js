const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatNotDoneCountLine } = require('../out/tools/not-done-count-line');

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

test('the compiled CLI reports the real not-done total (active + paused, excluding done) from a real repo\'s backlog', () => {
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

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'not-done-count-line.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.equal(output.trim(), 'Not done: 2 tickets');
});

test('the compiled CLI reports zero when every ticket is done', () => {
  const root = mkTmp();
  initRepo(root);
  writeRolesTsv(root);
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'done', 'BL-100.yaml'), 'id: BL-100\ntitle: Done one\nstatus: done\n');
  commitAll(root, 'all-done backlog');

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'not-done-count-line.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.equal(output.trim(), 'Not done: 0 tickets');
});
