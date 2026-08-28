const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { checkMintDurability, attemptSpecReadyHandoff } = require('../out/concierge/mintDurabilityGate');

function mkGitRepo() {
  const target = mkTmpDir('bl1190-mint-durability-');
  copySeededRepoInto(target);
  return target;
}

function git(cwd, args) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  execFileSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'ignore', 'pipe'], env });
}

test('checkMintDurability: refuses a paused yaml that exists on disk but was never committed', () => {
  const target = mkGitRepo();
  const rel = 'backlog/paused/BL-1190-slug.yaml';
  fs.mkdirSync(path.join(target, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(target, rel), 'id: BL-1190\n');

  const result = checkMintDurability(target, rel);

  assert.equal(result.refused, true);
  assert.match(result.reason, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('checkMintDurability: refuses a paused yaml path that does not exist on disk at all', () => {
  const target = mkGitRepo();
  const rel = 'backlog/paused/BL-1190-slug.yaml';

  const result = checkMintDurability(target, rel);

  assert.equal(result.refused, true);
});

test('checkMintDurability: does not refuse once the paused yaml is actually committed', () => {
  const target = mkGitRepo();
  const rel = 'backlog/paused/BL-1190-slug.yaml';
  fs.mkdirSync(path.join(target, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(target, rel), 'id: BL-1190\n');
  git(target, ['add', '--', rel]);
  git(target, ['commit', '-m', 'commit BL-1190 paused yaml']);

  const result = checkMintDurability(target, rel);

  assert.deepEqual(result, { refused: false });
});

test('attemptSpecReadyHandoff: never arms the ApprovalRequested path when the gate refuses', () => {
  const target = mkGitRepo();
  const rel = 'backlog/paused/BL-1190-slug.yaml';
  fs.mkdirSync(path.join(target, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(target, rel), 'id: BL-1190\n');
  let armed = false;

  const result = attemptSpecReadyHandoff(target, rel, () => {
    armed = true;
  });

  assert.equal(result.refused, true);
  assert.equal(armed, false, 'no ApprovalRequested path may be armed for an uncommitted paused yaml');
});

test('attemptSpecReadyHandoff: arms the ApprovalRequested path once the paused yaml is committed', () => {
  const target = mkGitRepo();
  const rel = 'backlog/paused/BL-1190-slug.yaml';
  fs.mkdirSync(path.join(target, 'backlog', 'paused'), { recursive: true });
  fs.writeFileSync(path.join(target, rel), 'id: BL-1190\n');
  git(target, ['add', '--', rel]);
  git(target, ['commit', '-m', 'commit BL-1190 paused yaml']);
  let armed = false;

  const result = attemptSpecReadyHandoff(target, rel, () => {
    armed = true;
  });

  assert.equal(result.refused, false);
  assert.equal(armed, true);
});
