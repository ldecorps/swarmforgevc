const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parkCycleLogPath, resolveRoleWorktreePath } = require('../out/tools/park-cycle-report');

// BL-343 hardening (BL-233 CLI-entrypoint CRAP trap): this CLI had zero
// tests of any kind before this pass, so its wiring logic sat at 0%
// in-process coverage despite a real, live-verified run. resolveRoleWorktreePath
// and parkCycleLogPath are now exported, pure, and unit-tested directly; the
// subprocess test below locks main()'s wiring the same way swarmMetricsCli's
// does, as an ADDITION, never the only cover.

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-parkcycle-cli-')));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// --- parkCycleLogPath ---

test('parkCycleLogPath resolves under .swarmforge/role-lifecycle/ off the project root', () => {
  assert.equal(parkCycleLogPath('/repo'), path.join('/repo', '.swarmforge', 'role-lifecycle', 'park-cycle-log.jsonl'));
});

// --- resolveRoleWorktreePath ---

test('resolveRoleWorktreePath returns the worktreePath of a role that is present', () => {
  const roles = [
    { role: 'coder', worktreeName: 'swarmforge-coder', worktreePath: '/repo/.worktrees/coder', displayName: 'Coder' },
    { role: 'architect', worktreeName: 'swarmforge-architect', worktreePath: '/repo/.worktrees/architect', displayName: 'Architect' },
  ];
  assert.equal(resolveRoleWorktreePath(roles, 'architect'), '/repo/.worktrees/architect');
});

test('resolveRoleWorktreePath returns null for a role absent from the roster, never a crash', () => {
  const roles = [{ role: 'coder', worktreeName: 'swarmforge-coder', worktreePath: '/repo/.worktrees/coder', displayName: 'Coder' }];
  assert.equal(resolveRoleWorktreePath(roles, 'hardender'), null);
});

test('resolveRoleWorktreePath returns null against an empty roster', () => {
  assert.equal(resolveRoleWorktreePath([], 'coder'), null);
});

// --- end-to-end: the compiled CLI actually runs headless and exits 0 ---

test('the compiled park-cycle-report CLI reports honestly-unmeasured on a fresh repo with no park-cycle log', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);

  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`
  );

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'park-cycle-report.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });
  const report = JSON.parse(output);

  assert.deepEqual(report, {
    measuredCycles: [],
    roleBreakEvenMs: {},
    totalDeltaTokens: 0,
    routingSavesMoney: null,
  });
});
