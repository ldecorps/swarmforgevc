const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatNeedsApprovalSection, main } = require('../out/tools/needs-approval-line');

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

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'needs-approval-line.js');

function runCliSubprocess(root) {
  return execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8' });
}

// Runs the REAL main() in-process against a real fixture repo, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (mirrors notifyDeadLettersCli.test.js's
// own identical seam). main() takes no arguments and reads process.cwd()
// internally (via resolveCliMainWorktreeContext). It prints via
// console.log (not printJsonToStdout/process.stdout.write) - under Vitest,
// console.log is NOT routed through process.stdout.write (Vitest
// intercepts console itself), so console.log must be mocked directly here
// to observe the output.
async function runCli(root) {
  const previousCwd = process.cwd();
  const writes = [];
  const originalLog = console.log;
  console.log = (chunk) => {
    writes.push(chunk);
  };
  try {
    process.chdir(root);
    await main();
  } finally {
    console.log = originalLog;
    process.chdir(previousCwd);
  }
  return writes.join('\n') + (writes.length > 0 ? '\n' : '');
}

test("the compiled CLI shows the nothing-awaiting-approval line when no ticket is pending", async () => {
  const root = mkTmp();
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'empty backlog');

  const output = await runCli(root);

  assert.match(output, /nothing awaiting approval/i);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and reports real pending tickets from a real repo\'s backlog', () => {
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

  const output = runCliSubprocess(root);

  assert.match(output, /BL-100: Needs review/);
  assert.doesNotMatch(output, /BL-101/);
});
