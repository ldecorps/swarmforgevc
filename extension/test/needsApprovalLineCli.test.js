const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatNeedsApprovalSection } = require('../out/tools/needs-approval-line');

// BL-251: the compiled needs-approval-line CLI is what briefing_email_lib.bb
// shells out to (Babashka cannot import compiled TS) - reuses
// computeBacklogDashboard's own needsApproval field unchanged (the SAME
// field backlog.json/the PWA already carry), never a second "pending"
// derivation. No translation pass (unlike generate-backlog-dashboard.js):
// the briefing is English-only prose, and running a translation session
// here would add unwanted side effects (network calls, cache writes) to a
// lightweight read.

// ── formatNeedsApprovalSection (pure) ─────────────────────────────────────

test('formats each entry by id and title, under a "Needs approval" heading', () => {
  const text = formatNeedsApprovalSection([{ id: 'BL-100', title: 'A ticket' }, { id: 'BL-101', title: 'Another' }]);
  assert.match(text, /^Needs approval:/);
  assert.match(text, /BL-100: A ticket/);
  assert.match(text, /BL-101: Another/);
});

test('an empty list renders an explicit nothing-awaiting-approval line, not a blank section', () => {
  const text = formatNeedsApprovalSection([]);
  assert.match(text, /nothing awaiting approval/i);
});

// ── end-to-end: the compiled CLI runs against a REAL git repo ────────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-needs-approval-cli-'));
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

test('the compiled CLI reports real pending tickets from a real repo\'s backlog', () => {
  const root = mkTmp();
  initRepo(root);
  writeRolesTsv(root);
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-100.yaml'),
    'id: BL-100\ntitle: Needs review\nstatus: active\nhuman_approval: pending\n'
  );
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-101.yaml'),
    'id: BL-101\ntitle: Already approved\nstatus: active\nhuman_approval: approved\n'
  );
  commitAll(root, 'seed backlog');

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'needs-approval-line.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.match(output, /BL-100: Needs review/);
  assert.doesNotMatch(output, /BL-101/);
});

test('the compiled CLI shows the nothing-awaiting-approval line when no ticket is pending', () => {
  const root = mkTmp();
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'empty backlog');

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'needs-approval-line.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.match(output, /nothing awaiting approval/i);
});
