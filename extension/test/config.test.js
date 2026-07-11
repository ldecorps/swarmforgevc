const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const {
  buildTargetBootstrapFiles,
  planTargetBootstrapFiles,
  initializeTargetRepo,
  buildContractBootstrapFiles,
  initializeTargetContract,
} = require('../out/config/targetBootstrap');
const { resolveTargetPath } = require('../out/config/targetPath');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bootstrap-'));
}

const FIXTURE_CONTRACT = {
  scope: ['Build the thing.'],
  outOfScope: ['Rewrite the stack.'],
  boundaries: ['Respect the README.'],
  initialBacklogSummary: '3 tickets queued.',
  agreement: 'proposed',
};

test('resolveTargetPath prefers configured workspace target', () => {
  const target = resolveTargetPath({
    configuredTargetPath: '  /tmp/target  ',
    workspaceFolders: [{ uri: { fsPath: '/workspace/fallback' } }],
  });

  assert.equal(target, '/tmp/target');
});

test('resolveTargetPath falls back to the first workspace folder', () => {
  const target = resolveTargetPath({
    configuredTargetPath: '',
    workspaceFolders: [
      { uri: { fsPath: '/workspace/one' } },
      { uri: { fsPath: '/workspace/two' } },
    ],
  });

  assert.equal(target, '/workspace/one');
});

test('buildTargetBootstrapFiles returns the two swarm bootstrap prompts', () => {
  const files = buildTargetBootstrapFiles();

  assert.deepEqual(files.map((file) => file.path), [
    'project.prompt',
    'engineering.prompt',
  ]);
  assert.match(files[0].content, /# Project/);
  assert.match(files[0].content, /# Goals for this swarm run/);
  assert.match(files[1].content, /# Tech Stack/);
  assert.match(files[1].content, /# Architecture rules/);
});

test('planTargetBootstrapFiles skips files that already exist', () => {
  const plan = planTargetBootstrapFiles(new Set(['engineering.prompt']));

  assert.deepEqual(plan.filesToCreate.map((file) => file.path), [
    'project.prompt',
  ]);
  assert.deepEqual(plan.alreadyPresent, ['engineering.prompt']);
});

test('planTargetBootstrapFiles creates all files when none exist', () => {
  const plan = planTargetBootstrapFiles(new Set());

  assert.deepEqual(plan.filesToCreate.map((file) => file.path), [
    'project.prompt',
    'engineering.prompt',
  ]);
  assert.deepEqual(plan.alreadyPresent, []);
});

test('planTargetBootstrapFiles skips all files when all exist', () => {
  const plan = planTargetBootstrapFiles(new Set(['project.prompt', 'engineering.prompt']));

  assert.deepEqual(plan.filesToCreate, []);
  assert.deepEqual(plan.alreadyPresent, ['project.prompt', 'engineering.prompt']);
});

test('resolveTargetPath returns undefined when no path and no workspace folders', () => {
  const target = resolveTargetPath({});
  assert.equal(target, undefined);
});

test('resolveTargetPath returns undefined when path is whitespace only', () => {
  const target = resolveTargetPath({ configuredTargetPath: '   ' });
  assert.equal(target, undefined);
});

test('initializeTargetRepo creates both prompt files in a non-git directory', async () => {
  const tmp = mkTmpDir();
  const result = await initializeTargetRepo(tmp);
  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.committed, false);
  assert.ok(fs.existsSync(path.join(tmp, 'project.prompt')));
  assert.ok(fs.existsSync(path.join(tmp, 'engineering.prompt')));
});

test('initializeTargetRepo skips files that already exist', async () => {
  const tmp = mkTmpDir();
  fs.writeFileSync(path.join(tmp, 'project.prompt'), 'existing content');
  const result = await initializeTargetRepo(tmp);
  assert.deepEqual(result.created, ['engineering.prompt']);
  assert.deepEqual(result.skipped, ['project.prompt']);
  assert.equal(fs.readFileSync(path.join(tmp, 'project.prompt'), 'utf8'), 'existing content');
});

test('initializeTargetRepo skips commit when all files already present', async () => {
  const tmp = mkTmpDir();
  fs.writeFileSync(path.join(tmp, 'project.prompt'), 'x');
  fs.writeFileSync(path.join(tmp, 'engineering.prompt'), 'x');
  const result = await initializeTargetRepo(tmp);
  assert.equal(result.committed, false);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.skipped.sort(), ['engineering.prompt', 'project.prompt']);
});

test('initializeTargetRepo commits new files in a git repository', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  const result = await initializeTargetRepo(tmp);
  assert.equal(result.committed, true);
  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  const log = execSync('git log --oneline', { cwd: tmp }).toString();
  assert.match(log, /Initialize SwarmForge target prompts/);
});

// ── BL-262: onboarding contract scaffold (extends the same idempotent seam) ──

test('buildContractBootstrapFiles returns the contract source and its legible view', () => {
  const files = buildContractBootstrapFiles(FIXTURE_CONTRACT);

  assert.deepEqual(
    files.map((file) => file.path),
    [path.join('.swarmforge', 'contract.yaml'), 'CONTRACT.md']
  );
  assert.match(files[0].content, /agreement: proposed/);
  assert.match(files[1].content, /Agreement: proposed/);
});

test('planTargetBootstrapFiles generalizes over an explicit file list (BL-262: not just the two prompts)', () => {
  const contractFiles = buildContractBootstrapFiles(FIXTURE_CONTRACT);

  const plan = planTargetBootstrapFiles(new Set([path.join('.swarmforge', 'contract.yaml')]), contractFiles);

  assert.deepEqual(plan.filesToCreate.map((file) => file.path), ['CONTRACT.md']);
  assert.deepEqual(plan.alreadyPresent, [path.join('.swarmforge', 'contract.yaml')]);
});

test('initializeTargetContract creates both contract files (including the nested .swarmforge/ dir) in a non-git directory', async () => {
  const tmp = mkTmpDir();
  const result = await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  assert.deepEqual(result.created.sort(), ['CONTRACT.md', path.join('.swarmforge', 'contract.yaml')].sort());
  assert.deepEqual(result.skipped, []);
  assert.equal(result.committed, false);
  assert.ok(fs.existsSync(path.join(tmp, '.swarmforge', 'contract.yaml')));
  assert.ok(fs.existsSync(path.join(tmp, 'CONTRACT.md')));
});

test('initializeTargetContract skips a contract file that already exists (idempotent scaffold)', async () => {
  const tmp = mkTmpDir();
  fs.mkdirSync(path.join(tmp, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.swarmforge', 'contract.yaml'), 'agreement: agreed\n');

  const result = await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  assert.deepEqual(result.created, ['CONTRACT.md']);
  assert.deepEqual(result.skipped, [path.join('.swarmforge', 'contract.yaml')]);
  assert.equal(fs.readFileSync(path.join(tmp, '.swarmforge', 'contract.yaml'), 'utf8'), 'agreement: agreed\n');
});

test('initializeTargetContract commits new contract files in a git repository with a distinct commit message', async () => {
  const tmp = mkTmpDir();
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });

  const result = await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  assert.equal(result.committed, true);
  const log = execSync('git log --oneline', { cwd: tmp }).toString();
  assert.match(log, /Propose SwarmForge onboarding contract/);
});

test('initializeTargetContract and initializeTargetRepo compose without interfering (both run on the same target)', async () => {
  const tmp = mkTmpDir();

  const promptResult = await initializeTargetRepo(tmp);
  const contractResult = await initializeTargetContract(tmp, FIXTURE_CONTRACT);

  assert.deepEqual(promptResult.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.deepEqual(contractResult.created.sort(), ['CONTRACT.md', path.join('.swarmforge', 'contract.yaml')].sort());
  assert.ok(fs.existsSync(path.join(tmp, 'project.prompt')));
  assert.ok(fs.existsSync(path.join(tmp, 'CONTRACT.md')));
});
