const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatQueueStatus } = require('../out/tools/queue-status');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-queue-status-cli-'));
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// --- formatQueueStatus ---

test('formatQueueStatus prints a pending count per role, no sidecar mention in default mode', () => {
  const views = [
    { role: 'coder', payloads: ['00_a.handoff'], sidecars: [{ name: '00_a.handoff.chase.json', kind: 'chase-sidecar' }] },
    { role: 'cleaner', payloads: [], sidecars: [] },
  ];
  const text = formatQueueStatus(views, false);
  assert.equal(text, ['[coder] 1 pending', '[cleaner] 0 pending'].join('\n'));
  assert.doesNotMatch(text, /sidecar/i);
});

test('BL-143 inbox-visibility-02: formatQueueStatus in debug mode lists sidecars with their labels', () => {
  const views = [
    { role: 'coder', payloads: ['00_a.handoff'], sidecars: [{ name: '00_a.handoff.chase.json', kind: 'chase-sidecar' }] },
  ];
  const text = formatQueueStatus(views, true);
  assert.equal(text, '[coder] 1 pending | sidecars (debug): 00_a.handoff.chase.json (chase-sidecar)');
});

test('formatQueueStatus in debug mode omits the sidecar suffix for a role with none', () => {
  const views = [{ role: 'coder', payloads: [], sidecars: [] }];
  assert.equal(formatQueueStatus(views, true), '[coder] 0 pending');
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

  assert.match(output, /\[coder\] 1 pending/);
  assert.doesNotMatch(output, /chase-sidecar/);

  const debugOutput = execFileSync('node', [cliPath, '--debug'], { cwd: root, encoding: 'utf8' });
  assert.match(debugOutput, /\[coder\] 1 pending \| sidecars \(debug\): 00_a\.handoff\.chase\.json \(chase-sidecar\)/);
});
