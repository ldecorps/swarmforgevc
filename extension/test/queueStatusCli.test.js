const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, formatQueueStatus, formatRoleStatus } = require('../out/tools/queue-status');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'queue-status.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-queue-status-cli-'));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function runCliSubprocess(root, args = []) {
  return execFileSync('node', [CLI_PATH, ...args], { cwd: root, encoding: 'utf8' });
}

// Runs the REAL main() in-process against a real fixture repo/cwd, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (the engineering article's CLI
// main()-thin-wrapper rule; mirrors notifyDeadLettersCli.test.js's own
// identical seam). main() takes no parameters - it reads process.argv
// (for --debug) and process.cwd() itself - so both are set to the same
// shape the subprocess would have received, and restored in finally
// (Vitest runs every test file in one worker process, so a stray cwd
// override silently corrupts every test that runs after it). cwd is a
// stubbed process.cwd(), never a real process.chdir(): Node disallows
// chdir() inside a worker thread, and Stryker's vitest-runner always runs
// tests in one, so a real chdir here would pass under plain `vitest run`
// but hard-abort every mutation run.
//
// queue-status.js prints via console.log, NOT process.stdout.write/
// printJsonToStdout - under Vitest, console.log does not route through
// process.stdout.write (Vitest intercepts console separately), so the
// mock must replace console.log itself or it silently captures nothing.
async function runCli(root, args = []) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const writes = [];
  const originalLog = console.log;
  console.log = (chunk) => {
    writes.push(chunk);
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    process.cwd = () => root;
    await main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
    process.argv = previousArgv;
  }
  return writes.join('');
}

function mkView({ role, newPayloads = [], inProcessPayloads = [], sidecars = [] }) {
  return { role, newPayloads, inProcessPayloads, sidecars };
}

// --- formatRoleStatus (BL-323: no work / new pending / claimed by nobody) ---

test('BL-323 resume-orphaned-inprocess-03: a role with both queues empty reports no work pending', () => {
  assert.equal(formatRoleStatus(mkView({ role: 'coder' })), '[coder] no work pending');
});

test('BL-323 resume-orphaned-inprocess-03: a role with only in_process work (new empty) reports work claimed by nobody', () => {
  assert.equal(
    formatRoleStatus(mkView({ role: 'coder', inProcessPayloads: ['00_a.handoff'] })),
    '[coder] work claimed by nobody (1 in_process, 0 new)'
  );
});

test('a role with new mail pending reports the new count, not "claimed by nobody"', () => {
  assert.equal(formatRoleStatus(mkView({ role: 'coder', newPayloads: ['00_a.handoff'] })), '[coder] 1 new pending');
});

test('a role with BOTH new mail and an in_process claim reports the new count plus the in_process count', () => {
  assert.equal(
    formatRoleStatus(mkView({ role: 'coder', newPayloads: ['00_a.handoff'], inProcessPayloads: ['00_b.handoff'] })),
    '[coder] 1 new pending, 1 in_process'
  );
});

// --- formatQueueStatus ---

test('formatQueueStatus reports each role\'s status line, no sidecar mention in default mode', () => {
  const views = [
    mkView({ role: 'coder', newPayloads: ['00_a.handoff'], sidecars: [{ name: '00_a.handoff.chase.json', kind: 'chase-sidecar' }] }),
    mkView({ role: 'cleaner' }),
  ];
  const text = formatQueueStatus(views, false);
  assert.equal(text, ['[coder] 1 new pending', '[cleaner] no work pending'].join('\n'));
  assert.doesNotMatch(text, /sidecar/i);
});

test('BL-143 inbox-visibility-02: formatQueueStatus in debug mode lists sidecars with their labels', () => {
  const views = [
    mkView({ role: 'coder', newPayloads: ['00_a.handoff'], sidecars: [{ name: '00_a.handoff.chase.json', kind: 'chase-sidecar' }] }),
  ];
  const text = formatQueueStatus(views, true);
  assert.equal(text, '[coder] 1 new pending | sidecars (debug): 00_a.handoff.chase.json (chase-sidecar)');
});

test('formatQueueStatus in debug mode omits the sidecar suffix for a role with none', () => {
  const views = [mkView({ role: 'coder' })];
  assert.equal(formatQueueStatus(views, true), '[coder] no work pending');
});

// --- end-to-end: the compiled CLI actually runs headless and exits 0 ---

function mkPayloadOnlyFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );
  // roles.tsv's worktreePath (3rd col) points at $root for the coder role,
  // so the CLI reads $root/.swarmforge/handoffs/inbox/new for it.
  const inboxNew = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
  fs.mkdirSync(inboxNew, { recursive: true });
  fs.writeFileSync(path.join(inboxNew, '00_a.handoff'), 'id: t\nfrom: a\nto: coder\npriority: 50\ntype: note\n\nbody\n');
  fs.writeFileSync(path.join(inboxNew, '00_a.handoff.chase.json'), '{}');
  return root;
}

test('the compiled queue-status CLI runs from a worktree, defaults to payload-only counts', async () => {
  const root = mkPayloadOnlyFixture();

  const output = await runCli(root);

  assert.match(output, /\[coder\] 1 new pending/);
  assert.doesNotMatch(output, /chase-sidecar/);

  const debugOutput = await runCli(root, ['--debug']);
  assert.match(debugOutput, /\[coder\] 1 new pending \| sidecars \(debug\): 00_a\.handoff\.chase\.json \(chase-sidecar\)/);
});

// BL-323: the exact real-incident shape - new/ empty, in_process holds an
// orphaned claim - must read distinctly from a genuinely idle role, from
// the compiled CLI end to end, not just the pure formatter.
test('BL-323: the compiled queue-status CLI reports "claimed by nobody" for an in_process-only role, distinct from idle', async () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  const coderWorktree = path.join(root, '.worktrees', 'coder');
  const cleanerWorktree = path.join(root, '.worktrees', 'cleaner');
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n` +
      `coder\tcoder\t${coderWorktree}\tswarmforge-coder\tCoder\tclaude\ttask\n` +
      `cleaner\tcleaner\t${cleanerWorktree}\tswarmforge-cleaner\tCleaner\tclaude\ttask\n`
  );
  const coderInProcess = path.join(coderWorktree, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(coderInProcess, { recursive: true });
  fs.writeFileSync(
    path.join(coderInProcess, '00_orphaned.handoff'),
    'id: t\nfrom: coordinator\nto: coder\npriority: 20\ntype: note\ndequeued_at: 2026-07-12T17:18:24Z\n\nbody\n'
  );

  const output = await runCli(root);

  assert.match(output, /\[coder\] work claimed by nobody \(1 in_process, 0 new\)/);
  assert.match(output, /\[cleaner\] no work pending/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkPayloadOnlyFixture();

  const output = runCliSubprocess(root);

  assert.match(output, /\[coder\] 1 new pending/);
  assert.doesNotMatch(output, /chase-sidecar/);
});
