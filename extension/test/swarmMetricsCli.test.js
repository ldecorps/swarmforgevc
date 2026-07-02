const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  resolveProjectRoot,
  resolveMainWorktreePath,
  formatOverview,
} = require('../out/tools/swarm-metrics');

// realpath: macOS resolves /var -> /private/var, and git rev-parse
// --show-toplevel returns the resolved path, so an un-resolved tmpdir would
// never string-equal what resolveProjectRoot returns.
function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-metrics-cli-')));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// --- resolveProjectRoot (BL-056 lesson: anchor at worktree/repo root) ---

test('resolveProjectRoot finds the root from the main checkout itself', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'specifier\tmaster\t' + root + '\tswarmforge-specifier\tSpecifier\tclaude\ttask\n');

  assert.equal(resolveProjectRoot(root), root);
});

test('resolveProjectRoot finds the root from inside a linked worktree', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'specifier\tmaster\t' + root + '\tswarmforge-specifier\tSpecifier\tclaude\ttask\n');

  const coderWt = path.join(root, '.worktrees', 'coder');
  git(root, ['worktree', 'add', '-q', '-b', 'coder', coderWt]);

  assert.equal(resolveProjectRoot(coderWt), root);
});

// --- resolveMainWorktreePath ---

test('resolveMainWorktreePath resolves to the specifier role worktree', () => {
  const roles = [
    { role: 'coder', worktreePath: '/repo/.worktrees/coder', displayName: 'Coder' },
    { role: 'specifier', worktreePath: '/repo', displayName: 'Specifier' },
  ];
  assert.equal(resolveMainWorktreePath('/repo', roles), '/repo');
});

test('resolveMainWorktreePath falls back to the coordinator role when no specifier is configured', () => {
  const roles = [{ role: 'coordinator', worktreePath: '/repo', displayName: 'Coordinator' }];
  assert.equal(resolveMainWorktreePath('/repo', roles), '/repo');
});

test('resolveMainWorktreePath falls back to the project root when neither role is configured', () => {
  assert.equal(resolveMainWorktreePath('/repo', []), '/repo');
});

// --- formatOverview (BL-071 swarm-metrics-07/09) ---

test('formatOverview prints a short plain-text overview with mean time, busyness, and retries', () => {
  const metrics = {
    meanTicketTimeMs: 4 * 60 * 60 * 1000 + 12 * 60 * 1000,
    ticketSampleCount: 23,
    busyness: { coder: 0.45, cleaner: 0.02 },
    retryTotal: 3,
    retryByTicket: { 'BL-101': 2, 'BL-102': 1 },
  };
  const text = formatOverview(metrics, ['coder', 'cleaner']);

  assert.match(text, /Mean ticket time: 4h 12m over 23 ticket/);
  assert.match(text, /coder 45%/);
  assert.match(text, /cleaner 2%/);
  assert.match(text, /Retries: 3 total/);
  assert.match(text, /BL-101 x2/);
  assert.equal(text.split('\n').length <= 5, true, 'expected a handful of lines, got more');
});

test('formatOverview on a fresh run prints placeholders, never NaN/Infinity/undefined', () => {
  const metrics = {
    meanTicketTimeMs: null,
    ticketSampleCount: 0,
    busyness: { coder: 0, cleaner: 0 },
    retryTotal: 0,
    retryByTicket: {},
  };
  const text = formatOverview(metrics, ['coder', 'cleaner']);

  assert.match(text, /Mean ticket time: —/);
  assert.match(text, /coder 0%/);
  assert.match(text, /Retries: 0 total/);
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
});

// --- end-to-end: the compiled CLI actually runs headless and exits 0 ---

test('the compiled swarm-metrics CLI runs from a worktree and exits 0 on a fresh repo', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  mkdirp(path.join(root, 'backlog', 'active'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\ncoder\tcoder\t${root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'swarm-metrics.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

  assert.match(output, /Mean ticket time: —/);
  assert.doesNotMatch(output, /NaN|Infinity|undefined/);
});
