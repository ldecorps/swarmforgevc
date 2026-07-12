const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatQueueStatus, formatRoleStatus } = require('../out/tools/queue-status');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-queue-status-cli-'));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('the compiled queue-status CLI runs from a worktree, defaults to payload-only counts', () => {
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

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'queue-status.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.match(output, /\[coder\] 1 new pending/);
  assert.doesNotMatch(output, /chase-sidecar/);

  const debugOutput = execFileSync('node', [cliPath, '--debug'], { cwd: root, encoding: 'utf8' });
  assert.match(debugOutput, /\[coder\] 1 new pending \| sidecars \(debug\): 00_a\.handoff\.chase\.json \(chase-sidecar\)/);
});

// BL-323: the exact real-incident shape - new/ empty, in_process holds an
// orphaned claim - must read distinctly from a genuinely idle role, from
// the compiled CLI end to end, not just the pure formatter.
test('BL-323: the compiled queue-status CLI reports "claimed by nobody" for an in_process-only role, distinct from idle', () => {
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

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'queue-status.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.match(output, /\[coder\] work claimed by nobody \(1 in_process, 0 new\)/);
  assert.match(output, /\[cleaner\] no work pending/);
});
