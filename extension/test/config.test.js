const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const {
  buildTargetBootstrapFiles,
  planTargetBootstrapFiles,
  initializeTargetRepo,
} = require('../out/config/targetBootstrap');
const { resolveTargetPath } = require('../out/config/targetPath');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bootstrap-'));
}

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
